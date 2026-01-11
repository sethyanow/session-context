#!/usr/bin/env python3
import re

# Read the file
with open('src/storage/handoffs.ts', 'r') as f:
    content = f.read()

# Replace imports
content = re.sub(r'import \{ createHash \} from "node:crypto";', '', content)
content = re.sub(
    r'import \{ mkdir, readFile, readdir, unlink, writeFile \} from "node:fs/promises";',
    'import { readdirSync, unlinkSync } from "node:fs";',
    content
)
content = re.sub(r'import \{ homedir \} from "node:os";', '', content)

# Replace homedir() with Bun.env.HOME
content = re.sub(r'homedir\(\)', 'Bun.env.HOME || process.env.HOME || ""', content)

# Replace getProjectHash
old_hash = '''export function getProjectHash(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 8);
}'''
new_hash = '''export function getProjectHash(projectRoot: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(projectRoot);
  return hasher.digest("hex").slice(0, 8);
}'''
content = content.replace(old_hash, new_hash)

# Replace ensureStorageDir
old_ensure = '''async function ensureStorageDir(): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
}'''
new_ensure = '''async function ensureStorageDir(): Promise<void> {
  const keepFile = join(STORAGE_DIR, ".keep");
  await Bun.write(keepFile, "");
}'''
content = content.replace(old_ensure, new_ensure)

# Replace readFile in readHandoff
content = re.sub(
    r'const content = await readFile\(path, "utf-8"\);\s+return JSON\.parse\(content\) as Handoff;',
    'const file = Bun.file(path);\n    if (!(await file.exists())) return null;\n    return (await file.json()) as Handoff;',
    content
)

# Replace writeFile
content = re.sub(
    r'await writeFile\(path, JSON\.stringify\(handoff, null, 2\), "utf-8"\);',
    'await Bun.write(path, JSON.stringify(handoff, null, 2));',
    content
)

# Replace readdir
content = re.sub(r'await readdir\(STORAGE_DIR\)', 'readdirSync(STORAGE_DIR)', content)

# Replace readFile in cleanup/list loops
content = re.sub(
    r'const content = await readFile\(path, "utf-8"\);\s+const handoff = JSON\.parse\(content\) as Handoff;',
    'const file = Bun.file(path);\n        const handoff = (await file.json()) as Handoff;',
    content
)

# Replace unlink
content = re.sub(r'await unlink\(path\);', 'unlinkSync(path);', content)

# Replace readFile in getConfig
old_config = '''const content = await readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as Partial<SessionContextConfig>;'''
new_config = '''const file = Bun.file(CONFIG_PATH);
    if (!(await file.exists())) return defaults;
    const config = (await file.json()) as Partial<SessionContextConfig>;'''
content = content.replace(old_config, new_config)

# Write the modified content
with open('src/storage/handoffs.ts', 'w') as f:
    f.write(content)

print("Conversion complete!")
