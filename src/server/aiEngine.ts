import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { DEFAULT_FACIAL_PROFILE } from '../types.ts';
import type { FacialProfile, StyleReference } from '../types.ts';
import { COMPOSITES_DIR, getSetting } from './db.ts';

function getGeminiClient(timeoutMs = 20000): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientCapacityError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : String((err as any)?.name || '');
  const code = String((err as any)?.code || '');
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const status = Number((err as any)?.status || 0);
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    code === 'ABORT_ERR' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('unavailable') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('high demand') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('aborterror') ||
    msg.includes('fetch failed')
  );
}

function sanitizeProfileJson(raw: Record<string, unknown>, base: FacialProfile): FacialProfile {
  const next: FacialProfile = { ...base };
  for (const key of Object.keys(DEFAULT_FACIAL_PROFILE) as (keyof FacialProfile)[]) {
    if (key === 'graphiteContrast' || key === 'pencilDetailWeight') continue;
    const candidate = raw[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      (next as any)[key] = candidate.trim();
    }
  }
  return next;
}

const PROFILE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    faceShape: { type: Type.STRING, description: 'e.g. oval, round, square, heart, oblong, diamond, or "unknown" if not mentioned' },
    forehead: { type: Type.STRING, description: 'e.g. broad, high, narrow, average, furrowed, or "unknown"' },
    hairline: { type: Type.STRING, description: 'e.g. straight, receding, widow peak, rounded, high, or "unknown"' },
    cheeks: { type: Type.STRING, description: 'e.g. prominent cheekbones, full, hollow, soft, or "unknown"' },
    jawline: { type: Type.STRING, description: 'e.g. strong angular, square, soft rounded, narrow, or "unknown"' },
    chin: { type: Type.STRING, description: 'e.g. rounded, cleft, pointed, square, prominent, or "unknown"' },
    eyeShape: { type: Type.STRING, description: 'e.g. almond, deep-set, hooded, round, upturned, or "unknown"' },
    eyeSpacing: { type: Type.STRING, description: 'e.g. average, wide-set, close-set, or "unknown"' },
    eyeSize: { type: Type.STRING, description: 'e.g. medium, large, narrow, small, or "unknown"' },
    eyebrowShape: { type: Type.STRING, description: 'e.g. straight, slightly arched, curved, angled, or "unknown"' },
    eyebrowThickness: { type: Type.STRING, description: 'e.g. thick, medium, thin, bushy, sparse, or "unknown"' },
    noseShape: { type: Type.STRING, description: 'e.g. straight, aquiline, button, upturned, rounded tip, or "unknown"' },
    noseWidth: { type: Type.STRING, description: 'e.g. broad, medium, narrow, or "unknown"' },
    noseBridge: { type: Type.STRING, description: 'e.g. high, medium, low, flat, prominent, or "unknown"' },
    lipShape: { type: Type.STRING, description: 'e.g. medium balanced, full, thin, defined cupid bow, or "unknown"' },
    mouthWidth: { type: Type.STRING, description: 'e.g. medium, wide, narrow, or "unknown"' },
    hairstyle: { type: Type.STRING, description: 'e.g. side-parted crop, buzz cut, wavy shoulder-length, slicked back, bald, or "unknown"' },
    hairLength: { type: Type.STRING, description: 'e.g. short, cropped, medium, shoulder-length, long, bald, or "unknown"' },
    hairTexture: { type: Type.STRING, description: 'e.g. straight, wavy, curly, coarse, coiled, fine, or "unknown"' },
    facialHair: { type: Type.STRING, description: 'e.g. clean-shaven, moustache, trimmed beard, stubble, goatee, or "unknown"' },
    beardMoustacheDetails: { type: Type.STRING, description: 'Exact beard/moustache description or "unknown"' },
    ears: { type: Type.STRING, description: 'e.g. close-set, average, prominent, attached lobes, or "unknown"' },
    glasses: { type: Type.STRING, description: 'e.g. none, rectangular wire-frame glasses, round spectacles, or "unknown"' },
    facialMarks: { type: Type.STRING, description: 'e.g. faint scar on left eyebrow, mole on right cheek, freckles, dimples, or "unknown"' },
    accessories: { type: Type.STRING, description: 'e.g. none, stud earrings, headband, or "unknown"' },
    subjectGenderPresentation: { type: Type.STRING, description: 'e.g. adult man, adult woman, androgynous adult, or "unknown"' },
    approximateAgeGroup: { type: Type.STRING, description: 'Always adult range, e.g. young adult (25-35), middle-aged adult (35-50), older adult (50-65), or "adult"' },
  },
  required: [
    'faceShape', 'forehead', 'hairline', 'cheeks', 'jawline', 'chin',
    'eyeShape', 'eyeSpacing', 'eyeSize', 'eyebrowShape', 'eyebrowThickness',
    'noseShape', 'noseWidth', 'noseBridge', 'lipShape', 'mouthWidth',
    'hairstyle', 'hairLength', 'hairTexture', 'facialHair', 'beardMoustacheDetails',
    'ears', 'glasses', 'facialMarks', 'accessories',
    'subjectGenderPresentation', 'approximateAgeGroup',
  ],
};

function fallbackKeywordExtract(description: string): FacialProfile {
  const lower = description.toLowerCase();
  const profile: FacialProfile = { ...DEFAULT_FACIAL_PROFILE };

  if (/\b(woman|female|lady)\b/.test(lower)) profile.subjectGenderPresentation = 'adult woman';
  else if (/\b(man|male|gentleman)\b/.test(lower)) profile.subjectGenderPresentation = 'adult man';

  if (/\b(20s|mid-20s|late 20s|young adult)\b/.test(lower)) profile.approximateAgeGroup = 'young adult (25-35)';
  else if (/\b(30s|late 30s|40s|mid-40s|middle[- ]aged)\b/.test(lower)) profile.approximateAgeGroup = 'middle-aged adult (35-50)';
  else if (/\b(50s|60s|older)\b/.test(lower)) profile.approximateAgeGroup = 'older adult (50-65)';

  const faceMatch = lower.match(/\b(oval|round|square|heart|diamond|oblong|angular)\s+face\b/);
  if (faceMatch) profile.faceShape = faceMatch[1];

  const foreheadMatch = lower.match(/\b(high|broad|wide|narrow|furrowed)\s+forehead\b/);
  if (foreheadMatch) profile.forehead = foreheadMatch[1];

  const hairlineMatch = lower.match(/\b(receding|straight|widow'?s?\s+peak|rounded)\s+hairline\b/);
  if (hairlineMatch) profile.hairline = hairlineMatch[1];

  const cheekMatch = lower.match(/\b(high|prominent|hollow|full|soft)\s+cheek(?:bone)?s?\b/);
  if (cheekMatch) profile.cheeks = `${cheekMatch[1]} cheekbones`;

  const jawMatch = lower.match(/\b(angular\s+square|strong|square|angular|sharp|soft|rounded|narrow)\s+jaw(?:line)?\b/);
  if (jawMatch) profile.jawline = jawMatch[1];

  const chinMatch =
    lower.match(/\b(narrower|narrow|cleft|pointed|rounded|square|prominent)\s+chin\b/) ||
    lower.match(/\bchin\s+(?:slightly\s+|more\s+)?(narrower|narrow|cleft|pointed|rounded|square|prominent|wider)\b/);
  if (chinMatch) profile.chin = chinMatch[1];

  if (/\bbeard\b/.test(lower) && /\bmoustache|mustache\b/.test(lower)) {
    profile.facialHair = 'beard and moustache';
    profile.beardMoustacheDetails = 'beard and moustache as described';
  } else if (/\btrimmed beard\b/.test(lower)) {
    profile.facialHair = 'trimmed beard';
    profile.beardMoustacheDetails = 'neatly trimmed beard';
  } else if (/\bbeard\b/.test(lower)) {
    profile.facialHair = 'beard';
  } else if (/\bmoustache|mustache\b/.test(lower)) {
    profile.facialHair = 'moustache';
    profile.beardMoustacheDetails = /\btrimmed\b/.test(lower) ? 'neatly trimmed moustache' : 'moustache';
  } else if (/\bstubble\b/.test(lower)) {
    profile.facialHair = 'light stubble';
  } else if (/\bclean[- ]shaven\b/.test(lower)) {
    profile.facialHair = 'clean-shaven';
  }

  if (/\b(?:no|without|remove)\s+(?:eye)?(?:glasses|spectacles)\b/.test(lower)) {
    profile.glasses = 'none';
  } else if (/\b(?:eyeglasses|glasses|spectacles)\b/.test(lower)) {
    const gMatch = description.match(/\b(?:thin\s+|thick\s+|round\s+|rectangular\s+|wire[- ]frame\s+){0,3}(?:eyeglasses|glasses|spectacles)\b/i);
    profile.glasses = gMatch ? gMatch[0].trim() : 'eyeglasses';
  }

  if (/\bshort\b.*\bhair\b/.test(lower)) profile.hairLength = 'short';
  else if (/\blong\b.*\bhair\b/.test(lower)) profile.hairLength = 'long';
  else if (/\bmedium\b.*\bhair\b/.test(lower)) profile.hairLength = 'medium';

  if (/\bwavy\b/.test(lower)) profile.hairTexture = 'wavy';
  else if (/\bcurly\b/.test(lower)) profile.hairTexture = 'curly';
  else if (/\bstraight\b.*\bhair\b/.test(lower)) profile.hairTexture = 'straight';

  if (/\bbroad nose|wide nose\b/.test(lower)) profile.noseWidth = 'broad';
  else if (/\bnarrow nose\b/.test(lower)) profile.noseWidth = 'narrow';

  const bridgeMatch = lower.match(/\b(narrow|high|low|flat|prominent|straight)\s+nose\s+bridge\b/);
  if (bridgeMatch) profile.noseBridge = bridgeMatch[1];

  if (/\bdeep[- ]set\b.*\beyes\b/.test(lower)) profile.eyeShape = 'deep-set';
  else if (/\balmond\b.*\beyes\b/.test(lower)) profile.eyeShape = 'almond';

  if (/\barched\b.*\beyebrows?\b/.test(lower)) profile.eyebrowShape = 'arched';
  else if (/\bstraight\b.*\beyebrows?\b/.test(lower)) profile.eyebrowShape = 'straight';

  if (/\bthick\b.*\beyebrows?\b|\bbushy eyebrows?\b/.test(lower)) profile.eyebrowThickness = 'thick';
  else if (/\bthin(?:ner)?\b.*\beyebrows?\b/.test(lower)) profile.eyebrowThickness = 'thin';

  const scarMatch = description.match(/\b(scar|mole|freckles|dimples)[^.,;]*/i);
  if (scarMatch) profile.facialMarks = scarMatch[0].trim();

  return profile;
}

export function applyRefinementDeltaFallback(current: FacialProfile, instruction: string): FacialProfile {
  const delta = fallbackKeywordExtract(instruction);
  const merged: FacialProfile = { ...current };
  for (const key of Object.keys(DEFAULT_FACIAL_PROFILE) as (keyof FacialProfile)[]) {
    if (key === 'graphiteContrast' || key === 'pencilDetailWeight' || key === 'approximateAgeGroup') continue;
    const val = delta[key];
    if (typeof val === 'string' && val !== 'unknown') {
      (merged as any)[key] = val;
    }
  }
  return merged;
}

export async function transcribeVoiceAudio(
  base64Audio: string,
  mimeType: string
): Promise<{ transcript: string; model: string; estimatedCostInr: number }> {
  const ai = getGeminiClient(30000);
  const model = getSetting('transcription_model', 'gemini-3.5-transcribe');

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType || 'audio/webm',
            data: base64Audio,
          },
        },
        {
          text: 'Transcribe this spoken facial composite description verbatim in clean English punctuation. Output only the spoken words without commentary.',
        },
      ],
    },
  });

  const transcript = (response.text ?? '').trim();
  if (!transcript) {
    throw new Error('No clear speech was detected in the recording. Please speak clearly and try again.');
  }

  return {
    transcript,
    model,
    estimatedCostInr: 0, // Free-tier Gemini 3.5 Transcribe usage
  };
}

export async function extractStructuredFacialProfile(
  description: string
): Promise<{ profile: FacialProfile; model: string; estimatedCostInr: number; usedFallback: boolean }> {
  const primaryModel = getSetting('extraction_model', 'gemini-3.8-flash');
  const candidateModels = primaryModel === 'gemini-3.1-flash-lite'
    ? [primaryModel]
    : [primaryModel, 'gemini-3.1-flash-lite'];

  const profileKeysPrompt = Object.keys(DEFAULT_FACIAL_PROFILE)
    .filter((k) => k !== 'graphiteContrast' && k !== 'pencilDetailWeight')
    .join(', ');

  let lastErr: unknown = null;
  for (const model of candidateModels) {
    try {
      const ai = getGeminiClient(28000);
      const supportsLowThinking = model.includes('gemini-3.8-flash') || model.includes('gemini-4-argon');
      const response = await ai.models.generateContent({
        model,
        contents:
          `Extract a structured illustrative facial profile JSON object with exact string keys (${profileKeysPrompt}) ` +
          `from the following fictional adult description:\n\n"${description}"`,
        config: {
          systemInstruction:
            'You are a precision forensic illustration assistant for fictional adult facial composites. ' +
            'Return ONLY valid JSON with exact string values for all requested keys. ' +
            'Preserve every explicitly supplied facial characteristic concisely. ' +
            'CRITICAL: If a facial trait is NOT mentioned or implied in the user description, set its value strictly to "unknown". ' +
            'Never invent missing traits. Ensure approximateAgeGroup is always an adult range.',
          responseMimeType: 'application/json',
          ...(supportsLowThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      const sanitized = sanitizeProfileJson(parsed, DEFAULT_FACIAL_PROFILE);
      return {
        profile: {
          ...sanitized,
          graphiteContrast: 65,
          pencilDetailWeight: 72,
        },
        model,
        estimatedCostInr: 0,
        usedFallback: false,
      };
    } catch (err) {
      lastErr = err;
      if (!isTransientCapacityError(err)) {
        break;
      }
    }
  }

  if (
    (lastErr instanceof Error && lastErr.message.includes('GEMINI_API_KEY is not configured')) ||
    isTransientCapacityError(lastErr)
  ) {
    return {
      profile: fallbackKeywordExtract(description),
      model: isTransientCapacityError(lastErr) ? 'deterministic-parser (gemini-capacity-failover)' : 'deterministic-parser',
      estimatedCostInr: 0,
      usedFallback: true,
    };
  }
  throw lastErr;
}

export async function updateProfileForRefinement(params: {
  currentProfile: FacialProfile;
  originalDescription: string;
  refinementInstruction: string;
  existingImageUrl?: string | null;
}): Promise<{ updatedProfile: FacialProfile; model: string }> {
  const primaryModel = getSetting('extraction_model', 'gemini-3.8-flash');
  const candidateModels = primaryModel === 'gemini-3.1-flash-lite'
    ? [primaryModel]
    : [primaryModel, 'gemini-3.1-flash-lite'];

  const promptText =
    `Current structured facial profile JSON:\n${JSON.stringify(params.currentProfile, null, 2)}\n\n` +
    `Original description: "${params.originalDescription}"\n\n` +
    `Requested refinement change to APPLY NOW: "${params.refinementInstruction}"\n\n` +
    `Return the complete updated JSON facial profile modifying ONLY the attributes targeted by the Requested refinement change while preserving every unrelated trait unchanged.`;

  for (const model of candidateModels) {
    try {
      const ai = getGeminiClient(25000);
      const supportsLowThinking = model.includes('gemini-3.8-flash') || model.includes('gemini-4-argon');
      const response = await ai.models.generateContent({
        model,
        contents: promptText,
        config: {
          systemInstruction:
            'You update a structured fictional adult facial composite profile JSON based on a user refinement instruction. ' +
            'Return ONLY valid JSON with the same keys as Current structured facial profile JSON. ' +
            'Always apply the requested refinement change to the relevant attribute fields (do not keep "unknown" for a newly added feature like glasses or beard) and preserve every unrelated trait unchanged.',
          responseMimeType: 'application/json',
          ...(supportsLowThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
      const baseUpdated = sanitizeProfileJson(parsed, params.currentProfile);
      baseUpdated.graphiteContrast = params.currentProfile.graphiteContrast;
      baseUpdated.pencilDetailWeight = params.currentProfile.pencilDetailWeight;

      // Guarantee explicit newly requested traits (e.g., eyeglasses) are never left as "unknown"
      const deterministicDelta = fallbackKeywordExtract(params.refinementInstruction);
      for (const key of Object.keys(DEFAULT_FACIAL_PROFILE) as (keyof FacialProfile)[]) {
        if (key === 'graphiteContrast' || key === 'pencilDetailWeight' || key === 'approximateAgeGroup') continue;
        if (baseUpdated[key] === 'unknown' && typeof deterministicDelta[key] === 'string' && deterministicDelta[key] !== 'unknown') {
          (baseUpdated as any)[key] = deterministicDelta[key];
        }
      }
      return {
        updatedProfile: baseUpdated,
        model,
      };
    } catch (err) {
      if (!isTransientCapacityError(err)) {
        return {
          updatedProfile: applyRefinementDeltaFallback(params.currentProfile, params.refinementInstruction),
          model: 'deterministic-delta',
        };
      }
    }
  }

  return {
    updatedProfile: applyRefinementDeltaFallback(params.currentProfile, params.refinementInstruction),
    model: 'deterministic-delta (gemini-capacity-failover)',
  };
}

export function buildForensicGraphitePrompt(params: {
  description: string;
  profile: FacialProfile;
  styleRef: StyleReference;
  refinementInstruction?: string | null;
}): { positivePrompt: string; negativePrompt: string } {
  const p = params.profile;
  const knownTraits: string[] = [];

  const addTrait = (label: string, val: string) => {
    if (val && val.trim().toLowerCase() !== 'unknown' && val.trim().toLowerCase() !== 'none') {
      knownTraits.push(`${label}: ${val.trim()}`);
    } else if (label === 'glasses' && val.trim().toLowerCase() === 'none') {
      knownTraits.push('no eyeglasses');
    } else if (label === 'facial hair' && val.trim().toLowerCase() === 'clean-shaven') {
      knownTraits.push('clean-shaven smooth jaw');
    }
  };

  addTrait('subject', p.subjectGenderPresentation !== 'unknown' ? `fictional ${p.subjectGenderPresentation}` : 'fictional adult person');
  addTrait('age group', p.approximateAgeGroup);
  addTrait('face shape', p.faceShape);
  addTrait('forehead', p.forehead);
  addTrait('hairline', p.hairline);
  addTrait('cheeks', p.cheeks);
  addTrait('jawline', p.jawline);
  addTrait('chin', p.chin);
  addTrait('eye shape', p.eyeShape);
  addTrait('eye spacing', p.eyeSpacing);
  addTrait('eye size', p.eyeSize);
  addTrait('eyebrow shape', p.eyebrowShape);
  addTrait('eyebrow thickness', p.eyebrowThickness);
  addTrait('nose shape', p.noseShape);
  addTrait('nose width', p.noseWidth);
  addTrait('nose bridge', p.noseBridge);
  addTrait('lip shape', p.lipShape);
  addTrait('mouth width', p.mouthWidth);
  addTrait('hairstyle', p.hairstyle);
  addTrait('hair length', p.hairLength);
  addTrait('hair texture', p.hairTexture);
  addTrait('facial hair', p.facialHair);
  addTrait('beard/moustache details', p.beardMoustacheDetails);
  addTrait('ears', p.ears);
  addTrait('glasses', p.glasses);
  addTrait('facial marks', p.facialMarks);
  addTrait('accessories', p.accessories);

  const lineWeightNote =
    p.pencilDetailWeight >= 70
      ? 'crisp fine-point 2B and 4B graphite line detail, intricate hair strand rendering'
      : 'soft blended HB graphite pencil strokes, gentle tonal transitions';

  const refinementEmphasis = params.refinementInstruction
    ? `Prominently incorporate refinement: (${params.refinementInstruction}:1.35). `
    : '';

  const positivePrompt = [
    params.styleRef.promptStyleDirective,
    refinementEmphasis,
    `Subject description: ${params.description.trim()}.`,
    knownTraits.length > 0 ? `Structured facial traits: ${knownTraits.join(', ')}.` : '',
    lineWeightNote,
    'centered front-facing head and neck portrait, looking straight ahead, neutral calm expression, plain clean white paper background, traditional monochrome pencil sketch',
  ]
    .filter(Boolean)
    .join(' ');

  const negativePrompt = `${params.styleRef.negativeDirective}, color, saturation, sepia, brown tint, blue tint, painting, 3d, cartoon, anime, doll, wax figure, cropped forehead, sunglasses unless specified, hat unless specified`;

  return { positivePrompt, negativePrompt };
}

async function postProcessToGraphiteSheet(
  rawImageBuffer: Buffer,
  paperTone: 'crisp_white' | 'warm_archival',
  contrastSlider: number
): Promise<Buffer> {
  // Normalize contrast multiplier between 1.04 and 1.28 based on user's graphiteContrast slider (30..90)
  const clampedContrast = Math.max(30, Math.min(90, contrastSlider || 65));
  const linearSlope = 1.0 + ((clampedContrast - 30) / 60) * 0.24;
  const linearOffset = -(linearSlope - 1.0) * 118;

  let pipeline = sharp(rawImageBuffer)
    .resize(1024, 1024, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .grayscale()
    .normalize()
    .linear(linearSlope, linearOffset)
    .sharpen({ sigma: 0.85, m1: 0.7, m2: 1.4 });

  if (paperTone === 'warm_archival') {
    // Subtle archival sketchpad tint (#F6F4EF) while preserving monochrome graphite feel
    pipeline = pipeline.toColorspace('srgb').tint({ r: 245, g: 243, b: 238 });
  }

  return pipeline.png({ compressionLevel: 6 }).toBuffer();
}

async function generateViaAiHorde(params: {
  positivePrompt: string;
  negativePrompt: string;
  seed: string;
  sourceImageBuffer?: Buffer;
}): Promise<{ rawBuffer: Buffer; modelUsed: string; seedUsed: string }> {
  const apiKey = process.env.AI_HORDE_API_KEY || '0000000000';
  const combinedPrompt = `${params.positivePrompt} ### ${params.negativePrompt}`;

  let sourceImageB64: string | undefined;
  if (params.sourceImageBuffer) {
    // Resize existing composite to 512x512 WebP/PNG for fast open-source img2img refinement
    const resized = await sharp(params.sourceImageBuffer)
      .resize(512, 512, { fit: 'cover' })
      .webp({ quality: 88 })
      .toBuffer();
    sourceImageB64 = resized.toString('base64');
  }

  const payload: Record<string, any> = {
    prompt: combinedPrompt,
    params: {
      sampler_name: 'k_euler_a',
      cfg_scale: 7.5,
      width: 512,
      height: 512,
      steps: 16,
      karras: true,
      seed: params.seed,
      n: 1,
      ...(sourceImageB64 ? { denoising_strength: 0.46 } : {}),
    },
    nsfw: false,
    censor_nsfw: true,
    models: ['AbsoluteReality', 'Deliberate', "ICBINP - I Can't Believe It's Not Photography", 'stable_diffusion'],
    r2: true,
    ...(sourceImageB64
      ? {
          source_image: sourceImageB64,
          source_processing: 'img2img',
        }
      : {}),
  };

  const submitRes = await fetch('https://stablehorde.net/api/v2/generate/async', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      'Client-Agent': 'dedsec-forensic-assistant:1.0:studio',
    },
    body: JSON.stringify(payload),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Open-source diffusion cluster rejected request (${submitRes.status}): ${errText.slice(0, 180)}`);
  }

  const submitData = (await submitRes.json()) as { id?: string; message?: string };
  if (!submitData.id) {
    throw new Error(submitData.message || 'Open-source diffusion cluster did not return a job ID.');
  }

  const deadline = Date.now() + 120000; // 120s timeout guard
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const checkRes = await fetch(`https://stablehorde.net/api/v2/generate/check/${submitData.id}`, {
      headers: { 'Client-Agent': 'dedsec-forensic-assistant:1.0:studio' },
    });
    if (!checkRes.ok) continue;
    const checkData = (await checkRes.json()) as { done?: boolean; faulted?: boolean; is_possible?: boolean };
    if (checkData.faulted || checkData.is_possible === false) {
      throw new Error('Open-source diffusion worker faulted on this request. Please retry.');
    }
    if (checkData.done) {
      const statusRes = await fetch(`https://stablehorde.net/api/v2/generate/status/${submitData.id}`, {
        headers: { 'Client-Agent': 'dedsec-forensic-assistant:1.0:studio' },
      });
      const statusData = (await statusRes.json()) as {
        generations?: { img: string; model: string; seed: string; censored?: boolean }[];
      };
      const gen = statusData.generations?.[0];
      if (!gen || !gen.img) {
        throw new Error('Provider completed without returning an image payload.');
      }
      if (gen.censored) {
        throw new Error('Composite generation was blocked by safety filters. Please adjust the description.');
      }

      let rawBuffer: Buffer;
      if (gen.img.startsWith('http')) {
        const imgFetch = await fetch(gen.img);
        if (!imgFetch.ok) {
          throw new Error(`Failed to retrieve generated composite asset (${imgFetch.status}).`);
        }
        rawBuffer = Buffer.from(await imgFetch.arrayBuffer());
      } else {
        rawBuffer = Buffer.from(gen.img, 'base64');
      }

      return {
        rawBuffer,
        modelUsed: gen.model || 'Deliberate',
        seedUsed: String(gen.seed || params.seed),
      };
    }
  }

  throw new Error('Image generation timed out waiting for an open-source worker. Please retry in a moment.');
}

async function generateViaLocalSdWebUi(params: {
  positivePrompt: string;
  negativePrompt: string;
  seed: string;
  sourceImageBuffer?: Buffer;
}): Promise<{ rawBuffer: Buffer; modelUsed: string; seedUsed: string }> {
  const baseUrl = (getSetting('local_sd_url', '') || process.env.LOCAL_SD_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Local Stable Diffusion WebUI URL is not configured in Admin > AI Management.');
  }

  const isImg2Img = Boolean(params.sourceImageBuffer);
  const endpoint = isImg2Img ? `${baseUrl}/sdapi/v1/img2img` : `${baseUrl}/sdapi/v1/txt2img`;
  const body: Record<string, any> = {
    prompt: params.positivePrompt,
    negative_prompt: params.negativePrompt,
    steps: 24,
    cfg_scale: 7,
    width: 768,
    height: 768,
    seed: Number(params.seed) || -1,
  };

  if (params.sourceImageBuffer) {
    body.init_images = [params.sourceImageBuffer.toString('base64')];
    body.denoising_strength = 0.45;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    throw new Error(`Local SD WebUI returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as { images?: string[] };
  if (!data.images?.[0]) {
    throw new Error('Local SD WebUI returned no image data.');
  }

  return {
    rawBuffer: Buffer.from(data.images[0], 'base64'),
    modelUsed: 'local-sd-webui',
    seedUsed: params.seed,
  };
}

async function generateViaHuggingFace(params: {
  positivePrompt: string;
}): Promise<{ rawBuffer: Buffer; modelUsed: string; seedUsed: string }> {
  const hfKey = process.env.HUGGINGFACE_API_KEY;
  if (!hfKey) {
    throw new Error('HUGGINGFACE_API_KEY is not configured in environment secrets.');
  }
  const model = 'black-forest-labs/FLUX.1-schnell';
  const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hfKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: params.positivePrompt }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Hugging Face Inference error (${res.status}): ${t.slice(0, 180)}`);
  }
  return {
    rawBuffer: Buffer.from(await res.arrayBuffer()),
    modelUsed: model,
    seedUsed: String(Math.floor(Math.random() * 999999999)),
  };
}

async function generateViaGeminiPaidImage(params: {
  positivePrompt: string;
  sourceImageBuffer?: Buffer;
  refinementInstruction?: string | null;
}): Promise<{ rawBuffer: Buffer; modelUsed: string; seedUsed: string; costInr: number }> {
  const approved = getSetting('paid_gemini_image_approved', 'false') === 'true';
  if (!approved) {
    throw new Error(
      'Paid Gemini Image model is locked by Cost Protection. An administrator must explicitly approve paid Gemini image generation before activation.'
    );
  }

  const ai = getGeminiClient();
  const model = 'gemini-3.1-flash-lite-image';
  const parts: any[] = [];

  if (params.sourceImageBuffer) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: params.sourceImageBuffer.toString('base64'),
      },
    });
    parts.push({
      text: `Edit this monochrome forensic graphite pencil composite sketch. Apply ONLY this modification while keeping the person's identity, proportions, lighting, and graphite paper texture identical: ${params.refinementInstruction}. ${params.positivePrompt}`,
    });
  } else {
    parts.push({ text: params.positivePrompt });
  }

  const response = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      imageConfig: {
        aspectRatio: '1:1',
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return {
        rawBuffer: Buffer.from(part.inlineData.data, 'base64'),
        modelUsed: model,
        seedUsed: String(Math.floor(Math.random() * 999999999)),
        costInr: 3.25, // Estimated ~₹3.25 per paid Gemini Flash Lite Image call
      };
    }
  }

  throw new Error('Gemini Image model did not return an image part.');
}

export async function synthesizeGraphiteComposite(params: {
  description: string;
  profile: FacialProfile;
  styleRef: StyleReference;
  seed?: string;
  existingImageUrl?: string | null;
  refinementInstruction?: string | null;
}): Promise<{
  imageUrl: string;
  promptUsed: string;
  provider: string;
  model: string;
  seed: string;
  estimatedCostInr: number;
}> {
  const activeProvider = getSetting('active_image_provider', 'ai_horde_graphite');
  const seed = params.seed || String(crypto.randomInt(10000000, 999999999));

  const { positivePrompt, negativePrompt } = buildForensicGraphitePrompt({
    description: params.description,
    profile: params.profile,
    styleRef: params.styleRef,
    refinementInstruction: params.refinementInstruction,
  });

  let sourceImageBuffer: Buffer | undefined;
  if (params.existingImageUrl && params.existingImageUrl.startsWith('/api/images/')) {
    const filename = path.basename(params.existingImageUrl);
    const fullPath = path.join(COMPOSITES_DIR, filename);
    if (fs.existsSync(fullPath)) {
      sourceImageBuffer = fs.readFileSync(fullPath);
    }
  }

  let rawBuffer: Buffer;
  let modelUsed = '';
  let seedUsed = seed;
  let estimatedCostInr = 0;

  if (activeProvider === 'local_sd_webui') {
    const res = await generateViaLocalSdWebUi({ positivePrompt, negativePrompt, seed, sourceImageBuffer });
    rawBuffer = res.rawBuffer;
    modelUsed = res.modelUsed;
    seedUsed = res.seedUsed;
    estimatedCostInr = 0;
  } else if (activeProvider === 'huggingface_sdxl') {
    const res = await generateViaHuggingFace({ positivePrompt });
    rawBuffer = res.rawBuffer;
    modelUsed = res.modelUsed;
    seedUsed = res.seedUsed;
    estimatedCostInr = 0.15;
  } else if (activeProvider === 'gemini_image') {
    const res = await generateViaGeminiPaidImage({
      positivePrompt,
      sourceImageBuffer,
      refinementInstruction: params.refinementInstruction,
    });
    rawBuffer = res.rawBuffer;
    modelUsed = res.modelUsed;
    seedUsed = res.seedUsed;
    estimatedCostInr = res.costInr;
  } else {
    const res = await generateViaAiHorde({
      positivePrompt,
      negativePrompt,
      seed,
      sourceImageBuffer,
    });
    rawBuffer = res.rawBuffer;
    modelUsed = res.modelUsed;
    seedUsed = res.seedUsed;
    estimatedCostInr = 0; // Community open-source worker cluster
  }

  const processedPng = await postProcessToGraphiteSheet(
    rawBuffer,
    params.styleRef.paperTone,
    params.profile.graphiteContrast
  );

  const filename = `composite_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
  const outputPath = path.join(COMPOSITES_DIR, filename);
  fs.writeFileSync(outputPath, processedPng);

  return {
    imageUrl: `/api/images/${filename}`,
    promptUsed: positivePrompt,
    provider: activeProvider,
    model: modelUsed,
    seed: seedUsed,
    estimatedCostInr,
  };
}
