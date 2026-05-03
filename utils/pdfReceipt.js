const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT_MARGIN = 48;

const escapePdfText = (value) => String(value ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/\(/g, "\\(")
  .replace(/\)/g, "\\)")
  .replace(/\r?\n/g, " ");

const wrapText = (text, maxChars = 72) => {
  const source = String(text || "").trim();
  if (!source) {
    return ["-"];
  }

  const paragraphs = source.split(/\n+/);
  const lines = [];

  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("-");
      return;
    }

    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) {
        current = candidate;
        return;
      }

      if (current) {
        lines.push(current);
      }

      if (word.length > maxChars) {
        for (let index = 0; index < word.length; index += maxChars) {
          const chunk = word.slice(index, index + maxChars);
          if (chunk.length === maxChars) {
            lines.push(chunk);
          } else {
            current = chunk;
          }
        }
        if (word.length % maxChars === 0) {
          current = "";
        }
        return;
      }

      current = word;
    });

    if (current) {
      lines.push(current);
    }
  });

  return lines.length ? lines : ["-"];
};

const buildPdfContent = (documentData) => {
  const commands = [];
  let cursorY = PAGE_HEIGHT - 56;

  const writeLine = (text, { font = "F1", size = 12, leading = 16, x = LEFT_MARGIN, color = "0.10 0.18 0.28" } = {}) => {
    if (cursorY < 60) {
      return;
    }

    commands.push(`${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${cursorY} Tm (${escapePdfText(text)}) Tj ET`);
    cursorY -= leading;
  };

  const drawSeparator = (color = "0.82 0.88 0.94") => {
    cursorY -= 4;
    commands.push(`${color} RG ${LEFT_MARGIN} ${cursorY} m ${PAGE_WIDTH - LEFT_MARGIN} ${cursorY} l S`);
    cursorY -= 16;
  };

  const drawFilledRect = (x, y, width, height, color) => {
    commands.push(`${color} rg ${x} ${y} ${width} ${height} re f`);
  };

  const drawStrokedRect = (x, y, width, height, color = "0.82 0.88 0.94") => {
    commands.push(`${color} RG ${x} ${y} ${width} ${height} re S`);
  };

  drawFilledRect(0, PAGE_HEIGHT - 112, PAGE_WIDTH, 112, "0.93 0.98 1.00");
  drawFilledRect(0, PAGE_HEIGHT - 112, 8, 112, "0.00 0.63 0.91");
  drawFilledRect(LEFT_MARGIN, PAGE_HEIGHT - 86, 42, 42, "0.00 0.63 0.91");

  writeLine(documentData.brand || "CortexConnect", { font: "F2", size: 20, leading: 24, x: 104, color: "0.03 0.29 0.42" });
  writeLine(documentData.title || "Appointment Receipt", { font: "F2", size: 15, leading: 20, x: 104, color: "0.10 0.18 0.28" });
  if (documentData.subtitle) {
    writeLine(documentData.subtitle, { font: "F1", size: 10, leading: 15, x: 104, color: "0.34 0.42 0.52" });
  }

  cursorY = PAGE_HEIGHT - 142;
  drawStrokedRect(LEFT_MARGIN, cursorY - 62, PAGE_WIDTH - (LEFT_MARGIN * 2), 78);

  writeLine(`Reference No: ${documentData.referenceNumber || "-"}`, { font: "F2", size: 12, leading: 18 });
  writeLine(`Status: ${documentData.statusLabel || "-"}`, { font: "F1", size: 11, leading: 16 });
  if (documentData.issuedAt) {
    writeLine(`Issued At: ${documentData.issuedAt}`, { font: "F1", size: 11, leading: 16 });
  }

  drawSeparator();

  (documentData.sections || []).forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      cursorY -= 6;
    }

    drawFilledRect(LEFT_MARGIN, cursorY - 4, PAGE_WIDTH - (LEFT_MARGIN * 2), 20, "0.96 0.98 1.00");
    writeLine(section.heading || "Section", { font: "F2", size: 12, leading: 22, color: "0.03 0.29 0.42" });

    (section.fields || []).forEach((field) => {
      const label = String(field.label || "").trim();
      const value = String(field.value || "-").trim() || "-";
      const combined = label ? `${label}: ${value}` : value;
      wrapText(combined, field.maxChars || 72).forEach((line) => {
        writeLine(line, { font: field.bold ? "F2" : "F1", size: field.size || 11, leading: field.leading || 15 });
      });
    });
  });

  drawSeparator();

  if (documentData.footer) {
    wrapText(documentData.footer, 78).forEach((line) => {
      writeLine(line, { font: "F1", size: 10, leading: 14, color: "0.34 0.42 0.52" });
    });
  }

  return commands.join("\n");
};

const buildPdfBuffer = (content) => {
  const objects = [
    null,
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`,
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf, "utf8");
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += `0000000000 65535 f \n`;

  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
};

const buildAppointmentReceiptPdf = (documentData) => {
  const content = buildPdfContent(documentData);
  return buildPdfBuffer(content);
};

const buildAppointmentReceiptFilename = (referenceNumber, patientName) => {
  const safeName = String(patientName || "patient")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "patient";
  const safeRef = String(referenceNumber || "appointment").replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safeName}_${safeRef}.pdf`;
};

module.exports = {
  buildAppointmentReceiptPdf,
  buildAppointmentReceiptFilename
};
