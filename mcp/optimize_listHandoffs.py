#!/usr/bin/env python3
"""
Script to optimize the listHandoffs function in handoffs.ts
"""

import re

# Read the file
with open('src/storage/handoffs.ts', 'r') as f:
    content = f.read()

# Find and replace the listHandoffs function
old_pattern = r'''// List all handoffs for a project
export async function listHandoffs\(projectRoot: string\): Promise<Handoff\[\]> \{
  try \{
    await ensureStorageDir\(\);
    const hash = getProjectHash\(projectRoot\);
    const files = await readdir\(getStorageDir\(\)\);
    const handoffs: Handoff\[\] = \[\];

    for \(const file of files\) \{
      if \(!file\.endsWith\("\.json"\)\) continue;

      const path = join\(getStorageDir\(\), file\);
      try \{
        const content = await readFile\(path, "utf-8"\);
        const handoff = JSON\.parse\(content\) as Handoff;
        if \(handoff\.project\.hash === hash\) \{
          handoffs\.push\(handoff\);
        \}
      \} catch \{
        // Skip invalid files
      \}
    \}

    return handoffs\.sort\(\(a, b\) => new Date\(b\.updated\)\.getTime\(\) - new Date\(a\.updated\)\.getTime\(\)\);
  \} catch \{
    return \[\];
  \}
\}'''

new_code = '''// List all handoffs for a project
export async function listHandoffs(projectRoot: string): Promise<Handoff[]> {
  try {
    await ensureStorageDir();
    const hash = getProjectHash(projectRoot);
    const files = await readdir(getStorageDir());
    const handoffs: Handoff[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      // Skip rolling checkpoints (format: {hash}-current.json)
      if (file.endsWith("-current.json")) continue;

      // Optimization: filter by filename pattern before reading
      // New format: {projectHash}.{id}.json
      const isNewFormat = file.startsWith(`${hash}.`);

      // Skip files that definitely don't belong to this project (new format from other projects)
      // New format files start with an 8-char hex hash followed by a dot
      if (!isNewFormat && file.match(/^[a-f0-9]{8}\\./)) {
        continue;
      }

      const path = join(getStorageDir(), file);
      try {
        const content = await readFile(path, "utf-8");
        const handoff = JSON.parse(content) as Handoff;

        // For old format files, still need to check the hash from content
        if (handoff.project.hash === hash) {
          handoffs.push(handoff);
        }
      } catch {
        // Skip invalid files
      }
    }

    return handoffs.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  } catch {
    return [];
  }
}'''

# Replace
content = re.sub(old_pattern, new_code, content, flags=re.MULTILINE)

# Write back
with open('src/storage/handoffs.ts', 'w') as f:
    f.write(content)

print("Successfully optimized listHandoffs function")
