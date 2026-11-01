import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, RotateCcw, Trash2, Check, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { GlassButton, GlassModal } from './LiquidGlassUI.tsx';

interface VoiceRecorderModalProps {
  open: boolean;
  onClose: () => void;
  onApproveTranscript: (approvedTranscript: string) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const VoiceRecorderModal: React.FC<VoiceRecorderModalProps> = ({
  open,
  onClose,
  onApproveTranscript,
  notify,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      stopMediaTracks();
      setIsRecording(false);
      setSecondsElapsed(0);
    }
    return () => stopMediaTracks();
  }, [open]);

  const stopMediaTracks = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startRecording = async () => {
    setPermissionError(null);
    chunksRef.current = [];

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionError('Microphone recording is not supported in this browser environment.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        stopMediaTracks();
        setIsRecording(false);

        if (chunksRef.current.length === 0) return;
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        await transcribeRecordedBlob(audioBlob, mimeType);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      setSecondsElapsed(0);

      timerRef.current = window.setInterval(() => {
        setSecondsElapsed((s) => s + 1);
      }, 1000);
    } catch (err: any) {
      const msg =
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
          ? 'Microphone permission was denied. Please grant microphone access in your browser address bar and retry.'
          : err?.message || 'Unable to access microphone.';
      setPermissionError(msg);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const transcribeRecordedBlob = async (blob: Blob, mimeType: string) => {
    setIsTranscribing(true);
    try {
      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = String(reader.result || '');
          const commaIdx = dataUrl.indexOf(',');
          resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
        };
        reader.onerror = () => reject(new Error('Failed to encode audio buffer.'));
        reader.readAsDataURL(blob);
      });

      const res = await api.transcribeVoice({
        audioBase64: base64Audio,
        mimeType: mimeType.split(';')[0] || 'audio/webm',
      });
      setTranscript((prev) => (prev ? `${prev} ${res.transcript}`.trim() : res.transcript));
      notify('success', 'Voice Transcribed', 'Review and edit the transcript below before applying.');
    } catch (err: any) {
      notify('error', 'Speech Transcription Error', err?.message || 'Could not transcribe recording.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title="Voice Description Input"
      subtitle="Speak facial characteristics naturally, review the transcript, and apply to the studio."
      maxWidthClass="max-w-xl"
    >
      <div className="space-y-4">
        {permissionError && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-400/25 flex items-start gap-2.5 text-xs text-red-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-300" />
            <span>{permissionError}</span>
          </div>
        )}

        {/* Recorder Control Bar */}
        <div className="p-4 rounded-xl bg-[#08090D]/80 border border-white/[0.08] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {!isRecording ? (
              <GlassButton
                type="button"
                variant="primary"
                onClick={startRecording}
                disabled={isTranscribing}
              >
                <Mic className="w-4 h-4" />
                {transcript ? 'Record Additional Detail' : 'Start Recording'}
              </GlassButton>
            ) : (
              <GlassButton type="button" variant="danger" onClick={stopRecording}>
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop Recording
              </GlassButton>
            )}

            {isRecording && (
              <span className="text-xs font-mono tabular-nums text-[#E8BB75]">
                Recording · {formatTime(secondsElapsed)}
              </span>
            )}
            {isTranscribing && (
              <span className="inline-flex items-center gap-1.5 text-xs text-[#7AA7FF]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Transcribing speech...
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <GlassButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setTranscript('');
                startRecording();
              }}
              disabled={isRecording || isTranscribing}
              title="Retry recording"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </GlassButton>
            <GlassButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setTranscript('')}
              disabled={!transcript || isRecording || isTranscribing}
              title="Clear transcript"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </GlassButton>
          </div>
        </div>

        {/* Editable Transcript Box */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[#989BA6]">
            Transcript Review &amp; Edit
          </label>
          <textarea
            rows={5}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Your spoken facial description will appear here after stopping the recording. You can freely edit any detail before applying."
            className="w-full p-3.5 text-sm rounded-xl bg-[#08090D]/90 border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/45 focus:outline-none focus:border-[#7AA7FF] resize-none leading-relaxed"
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.08]">
          <GlassButton type="button" variant="secondary" onClick={onClose}>
            Cancel
          </GlassButton>
          <GlassButton
            type="button"
            variant="primary"
            disabled={!transcript.trim() || isRecording || isTranscribing}
            onClick={() => {
              onApproveTranscript(transcript.trim());
              onClose();
            }}
          >
            <Check className="w-4 h-4" />
            Use Approved Transcript
          </GlassButton>
        </div>
      </div>
    </GlassModal>
  );
};
