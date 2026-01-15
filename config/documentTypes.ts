// Centralized document types and limits configuration
// This is the single source of truth for allowed formats and size limits per module.

export type ModuleKey = 'SMART_DRAFTING';

// Allowed file extensions per module (lowercase, without dots)
export const ALLOWED_EXTENSIONS: Record<ModuleKey, string[]> = {
  SMART_DRAFTING: ['pdf', 'doc', 'docx', 'txt'],
};

// Max file size (in MB) per module
export const MAX_FILE_SIZE_MB: Record<ModuleKey, number> = {
  SMART_DRAFTING: 20, // per file
};

// Total max size (in MB) for a single selection/upload operation per module
export const TOTAL_MAX_FILE_SIZE_MB: Record<ModuleKey, number> = {
  SMART_DRAFTING: 100,
};

export function getAcceptAttributeForModule(module: ModuleKey): string {
  return ALLOWED_EXTENSIONS[module].map((ext) => `.${ext}`).join(',');
}

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

export function isExtensionAllowedForModule(filename: string, module: ModuleKey): boolean {
  const ext = getFileExtension(filename);
  return ALLOWED_EXTENSIONS[module].includes(ext);
}

export function validateFilesForModule(files: File[], module: ModuleKey): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const perFileLimitBytes = MAX_FILE_SIZE_MB[module] * 1024 * 1024;
  const totalLimitBytes = TOTAL_MAX_FILE_SIZE_MB[module] * 1024 * 1024;
  let total = 0;

  for (const file of files) {
    if (!isExtensionAllowedForModule(file.name, module)) {
      errors.push(`File type not allowed: ${file.name}`);
    }
    if (file.size > perFileLimitBytes) {
      errors.push(`File too large (>${MAX_FILE_SIZE_MB[module]}MB): ${file.name}`);
    }
    total += file.size;
  }

  if (total > totalLimitBytes) {
    errors.push(`Total size exceeds ${TOTAL_MAX_FILE_SIZE_MB[module]}MB`);
  }

  return { ok: errors.length === 0, errors };
}

export function sanitizeFilename(name: string): string {
  // Remove path segments and unsafe characters, keep spaces, dashes, underscores, dots
  const base = name.split(/[/\\]/).pop() || name;
  return base.replace(/[^\w.\- \u00C0-\u024F]+/g, '_');
}


