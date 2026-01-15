/**
 * Utility functions for extracting text from documents client-side
 * Supports PDF, DOCX, and plain text files
 *
 * Usage:
 * ```typescript
 * const text = await extractTextFromFile(file);
 * ```
 */

// Type definitions for PDF.js and Mammoth
type PdfTextItem = { str: string };
type PdfTextContent = { items: PdfTextItem[] };
type PdfPage = { getTextContent: () => Promise<PdfTextContent> };

type PdfJsModule = {
  getDocument: (options: { data: ArrayBuffer }) => {
    promise: Promise<PdfDocument>;
  };
  GlobalWorkerOptions: { workerSrc: string };
};

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
};

type MammothModule = {
  extractRawText: (options: {
    arrayBuffer: ArrayBuffer;
  }) => Promise<{ value?: string | null }>;
};

/**
 * Load PDF.js library dynamically from CDN
 */
async function loadPdfJs(): Promise<PdfJsModule> {
  try {
    // Try primary CDN
    const pdfjsLib = await import(
      /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.mjs"
    );
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.worker.min.mjs";
    return pdfjsLib as any;
  } catch (_) {
    try {
      // Fallback CDN
      const pdfjsLib = await import(
        /* @vite-ignore */ "https://unpkg.com/pdfjs-dist@4.4.168/legacy/build/pdf.mjs"
      );
      (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
        "https://unpkg.com/pdfjs-dist@4.4.168/legacy/build/pdf.worker.min.mjs";
      return pdfjsLib as any;
    } catch (e) {
      throw new Error("Failed to load PDF.js library from CDN");
    }
  }
}

/**
 * Load Mammoth library dynamically from CDN
 */
async function loadMammoth(): Promise<MammothModule> {
  try {
    // Try ESM CDN
    const mod = await import(
      /* @vite-ignore */ "https://esm.sh/mammoth@1.6.0/mammoth.browser.js"
    );
    const mammothModule = (mod as any)?.extractRawText
      ? mod
      : (mod as any)?.default
      ? (mod as any).default
      : (mod as any)?.mammoth;

    if (
      mammothModule &&
      (mammothModule.extractRawText || mammothModule.convertToHtml)
    ) {
      return mammothModule as any;
    }
  } catch (_) {
    // Continue to UMD fallback
  }

  // Fallback: Load UMD bundle from CDN
  return new Promise<MammothModule>((resolve, reject) => {
    // Check if already loaded
    const existing = document.querySelector(
      'script[src*="mammoth.browser.min.js"]'
    );
    if (existing && (window as any).mammoth) {
      return resolve((window as any).mammoth);
    }

    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js";
    script.async = true;
    script.onload = () => {
      const mammoth = (window as any).mammoth;
      if (mammoth) {
        resolve(mammoth);
      } else {
        reject(new Error("Mammoth failed to initialize"));
      }
    };
    script.onerror = () =>
      reject(new Error("Failed to load mammoth.js from CDN"));
    document.head.appendChild(script);
  });
}

/**
 * Extract text from a PDF file
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const pdfjsLib = await loadPdfJs();

    const task = pdfjsLib.getDocument({ data: buf });
    const pdf = await task.promise;

    let text = "";
    let hasContent = false;

    // Extract text from each page
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => item.str)
        .join(" ")
        .trim();

      // Only add separator and page text if page has content
      if (pageText.length > 0) {
        if (hasContent) {
          text += "\n\n---\n\n";
        }
        text += pageText;
        hasContent = true;
      }
    }

    return text.trim();
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw new Error(
      `Failed to extract text from PDF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Extract text from a DOCX file
 */
export async function extractTextFromDocx(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const mammoth = await loadMammoth();

    if (typeof mammoth.extractRawText === "function") {
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      return (result?.value || "").toString().trim();
    } else if (typeof mammoth.convertToHtml === "function") {
      // Fallback: convert to HTML and extract text
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      const html = (result?.value || "").toString();
      // Strip HTML tags and extract text
      const text = html
        .replace(/<\/?(script|style)[^>]*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return text;
    } else {
      throw new Error("Mammoth API not found");
    }
  } catch (error) {
    console.error("Error extracting text from DOCX:", error);
    throw new Error(
      `Failed to extract text from DOCX: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Extract text from a plain text file
 */
export async function extractTextFromText(file: File): Promise<string> {
  try {
    return await file.text();
  } catch (error) {
    console.error("Error extracting text from text file:", error);
    throw new Error(
      `Failed to extract text from file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Extract text from a file based on its type
 * Supports: PDF, DOCX, DOC, TXT, CSV, and other text files
 *
 * @param file - The file to extract text from
 * @returns Extracted text as string
 * @throws Error if extraction fails or file type is not supported
 *
 * @example
 * ```typescript
 * const file = event.target.files[0];
 * try {
 *   const extractedText = await extractTextFromFile(file);
 *   console.log("Extracted text:", extractedText);
 * } catch (error) {
 *   console.error("Extraction failed:", error);
 * }
 * ```
 */
export async function extractTextFromFile(file: File): Promise<string> {
  if (!file) {
    throw new Error("No file provided");
  }

  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  // PDF files
  if (fileName.endsWith(".pdf") || fileType === "application/pdf") {
    return extractTextFromPdf(file);
  }

  // DOCX files
  if (
    fileName.endsWith(".docx") ||
    fileType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractTextFromDocx(file);
  }

  // Legacy DOC files (note: Mammoth doesn't support .doc, might need server-side conversion)
  if (fileName.endsWith(".doc") || fileType === "application/msword") {
    throw new Error(
      "Legacy .doc files are not supported. Please convert to .docx first."
    );
  }

  // Text files (TXT, CSV, etc.)
  if (
    fileName.endsWith(".txt") ||
    fileName.endsWith(".csv") ||
    fileType.startsWith("text/")
  ) {
    return extractTextFromText(file);
  }

  throw new Error(
    `Unsupported file type: ${
      fileType || "unknown"
    }. Supported types: PDF, DOCX, TXT, CSV`
  );
}

/**
 * Extract text from a file URL (signed URL from Supabase Storage)
 * Fetches the file first, then extracts text
 *
 * @param fileUrl - Signed URL to the file
 * @param fileName - Original filename (used to determine file type)
 * @returns Extracted text as string
 *
 * @example
 * ```typescript
 * const { data } = await supabase.storage
 *   .from('docs-autofills')
 *   .createSignedUrl(filePath, 3600);
 *
 * const text = await extractTextFromFileUrl(data.signedUrl, fileName);
 * ```
 */
export async function extractTextFromFileUrl(
  fileUrl: string,
  fileName: string
): Promise<string> {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    const blob = await response.blob();
    const file = new File([blob], fileName, { type: blob.type });

    return extractTextFromFile(file);
  } catch (error) {
    console.error("Error extracting text from file URL:", error);
    throw new Error(
      `Failed to extract text from URL: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Extract text from a Supabase Storage file path
 * Gets signed URL and extracts text
 *
 * @param supabase - Supabase client instance
 * @param bucket - Storage bucket name
 * @param filePath - Path to file in storage
 * @param fileName - Original filename
 * @param expiration - URL expiration in seconds (default: 3600 = 1 hour)
 * @returns Extracted text as string
 *
 * @example
 * ```typescript
 * import { supabase } from '@/integrations/supabase/client';
 *
 * const text = await extractTextFromSupabaseStorage(
 *   supabase,
 *   'docs-autofills',
 *   'workspace-id/uuid__filename.pdf',
 *   'filename.pdf'
 * );
 * ```
 */
export async function extractTextFromSupabaseStorage(
  supabase: any,
  bucket: string,
  filePath: string,
  fileName: string,
  expiration: number = 3600
): Promise<string> {
  try {
    // Get signed URL
    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, expiration);

    if (urlError || !signedUrlData?.signedUrl) {
      throw new Error(
        `Failed to get signed URL: ${urlError?.message || "Unknown error"}`
      );
    }

    // Extract text from the signed URL
    return extractTextFromFileUrl(signedUrlData.signedUrl, fileName);
  } catch (error) {
    console.error("Error extracting text from Supabase Storage:", error);
    throw error;
  }
}
