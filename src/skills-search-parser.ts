export interface SkillSearchResult {
  package: string;
  url: string;
  installs?: string;
}

/**
 * Parse output from `npx skills find <query>`.
 * Supports lines like:
 *   owner/repo@skill-name 31.2K installs
 *   └ https://skills.sh/owner/repo/skill-name
 */
export function parseSkillsSearchOutput(output: string): SkillSearchResult[] {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split('\n').map((line) => line.trim()).filter(Boolean);
  const results: SkillSearchResult[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pkgMatch = line.match(
      /^([\w-]+\/[\w.-]+(?:@[\w.-]+)?)(?:\s+.*)?$/,
    );
    if (!pkgMatch) {
      continue;
    }

    const pkg = pkgMatch[1];
    const installsMatch = line.match(
      /([0-9][0-9.,]*(?:\.[0-9]+)?[KMB]?)\s+installs\b/i,
    );
    const installs = installsMatch?.[1];
    if (seen.has(pkg)) {
      continue;
    }

    let url = '';
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].replace(/^[└├│─\s]+/u, '');
      const urlMatch = nextLine.match(/^https?:\/\/\S+/);
      if (urlMatch) {
        url = urlMatch[0];
        i++;
      }
    }

    results.push({ package: pkg, url, installs });
    seen.add(pkg);
  }

  return results;
}
