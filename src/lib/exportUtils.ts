import { jsPDF } from 'jspdf';
import { ForensicCase } from '../types.ts';

async function loadImageAsCanvasDataUrl(imageUrl: string, mimeType: 'image/png' | 'image/jpeg'): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1024;
      canvas.height = img.naturalHeight || 1024;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Unable to initialize export canvas.'));
        return;
      }
      // Fill pure white paper background for JPEG exports
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL(mimeType, 0.95));
    };
    img.onerror = () => reject(new Error('Failed to load composite image for export.'));
    img.src = imageUrl;
  });
}

function sanitizeFileSlug(title: string): string {
  return (title || 'dedsec_composite')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

export async function downloadCompositeImage(
  imageUrl: string,
  title: string,
  format: 'png' | 'jpeg'
): Promise<void> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const dataUrl = await loadImageAsCanvasDataUrl(imageUrl, mime);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${sanitizeFileSlug(title)}.${format === 'jpeg' ? 'jpg' : 'png'}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function exportCasePdfReport(caseRecord: ForensicCase): Promise<void> {
  if (!caseRecord.activeImageUrl) {
    throw new Error('Generate a composite image before exporting a PDF case report.');
  }

  const imgDataUrl = await loadImageAsCanvasDataUrl(caseRecord.activeImageUrl, 'image/jpeg');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  // Header Bar
  doc.setFillColor(12, 13, 18);
  doc.rect(0, 0, pageWidth, 28, 'F');
  doc.setTextColor(245, 245, 247);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('DEDSEC AI FORENSIC ASSISTANT', 14, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(160, 165, 180);
  doc.text('ILLUSTRATIVE FACIAL COMPOSITE CASE DOSSIER', 14, 20);
  doc.text(`Ref: ${caseRecord.id.toUpperCase()}`, pageWidth - 14, 13, { align: 'right' });
  doc.text(`Created: ${new Date(caseRecord.createdAt).toLocaleDateString()}`, pageWidth - 14, 20, {
    align: 'right',
  });

  y = 36;

  // Case Title
  doc.setTextColor(18, 20, 26);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(caseRecord.title, 14, y);
  y += 7;

  // Composite Image Box (Left) + Metadata Summary (Right)
  doc.setDrawColor(210, 214, 222);
  doc.rect(14, y, 82, 82);
  doc.addImage(imgDataUrl, 'JPEG', 15, y + 1, 80, 80);

  const rightX = 102;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Original Description', rightX, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(55, 60, 70);
  const descLines = doc.splitTextToSize(caseRecord.originalDescription || 'None provided.', pageWidth - rightX - 14);
  doc.text(descLines.slice(0, 10), rightX, y + 11);

  const latestVer = caseRecord.versions[caseRecord.versions.length - 1];
  const metaStartY = y + 56;
  doc.setTextColor(18, 20, 26);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Generation Metadata', rightX, metaStartY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(65, 70, 82);
  doc.text(`Total Versions: ${caseRecord.versions.length}`, rightX, metaStartY + 6);
  if (latestVer) {
    doc.text(`Active Version: v${latestVer.versionNumber} (${latestVer.provider} / ${latestVer.model})`, rightX, metaStartY + 11);
    doc.text(`Seed Reference: ${latestVer.seed}`, rightX, metaStartY + 16);
  }
  doc.text(`Last Updated: ${new Date(caseRecord.updatedAt).toLocaleString()}`, rightX, metaStartY + 21);

  y += 90;

  // Structured Facial Profile Grid
  doc.setTextColor(18, 20, 26);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Structured Facial Profile', 14, y);
  y += 5;

  const p = caseRecord.profile;
  const traits: [string, string][] = [
    ['Subject', p.subjectGenderPresentation],
    ['Age Group', p.approximateAgeGroup],
    ['Face Shape', p.faceShape],
    ['Forehead', p.forehead],
    ['Hairline', p.hairline],
    ['Cheeks', p.cheeks],
    ['Jawline', p.jawline],
    ['Chin', p.chin],
    ['Eye Shape', p.eyeShape],
    ['Eye Spacing', p.eyeSpacing],
    ['Eye Size', p.eyeSize],
    ['Eyebrow Shape', p.eyebrowShape],
    ['Eyebrow Thickness', p.eyebrowThickness],
    ['Nose Shape', p.noseShape],
    ['Nose Width', p.noseWidth],
    ['Nose Bridge', p.noseBridge],
    ['Lip Shape', p.lipShape],
    ['Mouth Width', p.mouthWidth],
    ['Hairstyle', p.hairstyle],
    ['Hair Length', p.hairLength],
    ['Hair Texture', p.hairTexture],
    ['Facial Hair', p.facialHair],
    ['Glasses', p.glasses],
    ['Marks / Accessories', `${p.facialMarks} / ${p.accessories}`],
  ];

  doc.setFontSize(8);
  const colWidth = (pageWidth - 28) / 2;
  for (let i = 0; i < traits.length; i += 2) {
    const rowY = y + (i / 2) * 5.8;
    doc.setFillColor(i % 4 === 0 ? 246 : 252, i % 4 === 0 ? 247 : 252, i % 4 === 0 ? 250 : 254);
    doc.rect(14, rowY - 3.8, pageWidth - 28, 5.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 45, 55);
    doc.text(`${traits[i][0]}:`, 16, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(String(traits[i][1] || 'unknown').slice(0, 34), 48, rowY);

    if (traits[i + 1]) {
      doc.setFont('helvetica', 'bold');
      doc.text(`${traits[i + 1][0]}:`, 16 + colWidth, rowY);
      doc.setFont('helvetica', 'normal');
      doc.text(String(traits[i + 1][1] || 'unknown').slice(0, 34), 52 + colWidth, rowY);
    }
  }

  y += Math.ceil(traits.length / 2) * 5.8 + 6;

  // Refinement History & Case Notes
  const refinements = caseRecord.versions.filter((v) => v.refinementInstruction);
  if (refinements.length > 0 && y < 252) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(18, 20, 26);
    doc.text('Refinement Audit History', 14, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60, 65, 78);
    for (const rv of refinements.slice(-4)) {
      doc.text(`• v${rv.versionNumber}: ${rv.refinementInstruction} (${new Date(rv.createdAt).toLocaleDateString()})`, 16, y);
      y += 4.6;
    }
    y += 2;
  }

  if (caseRecord.notes && y < 265) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(18, 20, 26);
    doc.text('Investigator / Studio Notes', 14, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const noteLines = doc.splitTextToSize(caseRecord.notes, pageWidth - 28);
    doc.text(noteLines.slice(0, 3), 14, y);
  }

  // Mandatory Responsible Product Positioning Disclaimer Footer
  doc.setDrawColor(215, 218, 225);
  doc.line(14, 276, pageWidth - 14, 276);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(110, 115, 128);
  doc.text(
    'ILLUSTRATIVE USE DISCLAIMER: DEDSEC generates fictional, illustrative facial composites from text/voice descriptions. ' +
      'It is NOT a biometric identification or facial-recognition system and does not reliably depict or identify any real individual.',
    14,
    281,
    { maxWidth: pageWidth - 28 }
  );

  doc.save(`${sanitizeFileSlug(caseRecord.title)}_report.pdf`);
}
