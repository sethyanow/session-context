import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Bun API standardization", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `bun-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await Bun.write(join(testDir, ".keep"), "");
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      const proc = Bun.spawn(["rm", "-rf", testDir]);
      await proc.exited;
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("File operations", () => {
    test("Bun.file() reads file content", async () => {
      const testFile = join(testDir, "test.txt");
      await Bun.write(testFile, "Hello Bun");

      const file = Bun.file(testFile);
      const content = await file.text();

      expect(content).toBe("Hello Bun");
    });

    test("Bun.write() creates files", async () => {
      const testFile = join(testDir, "write-test.txt");
      await Bun.write(testFile, "Written by Bun");

      const file = Bun.file(testFile);
      const content = await file.text();

      expect(content).toBe("Written by Bun");
    });

    test("Bun.file().exists() checks file existence", async () => {
      const existingFile = join(testDir, "exists.txt");
      const nonExistingFile = join(testDir, "does-not-exist.txt");

      await Bun.write(existingFile, "exists");

      const exists = await Bun.file(existingFile).exists();
      const notExists = await Bun.file(nonExistingFile).exists();

      expect(exists).toBe(true);
      expect(notExists).toBe(false);
    });

    test("Bun.file().json() reads JSON files", async () => {
      const jsonFile = join(testDir, "data.json");
      const data = { name: "Bun", version: 1 };

      await Bun.write(jsonFile, JSON.stringify(data));

      const file = Bun.file(jsonFile);
      const parsed = await file.json();

      expect(parsed).toEqual(data);
    });
  });

  describe("Process spawning", () => {
    test("Bun.spawn() executes commands", async () => {
      const proc = Bun.spawn(["echo", "Hello from Bun"]);
      const output = await new Response(proc.stdout).text();

      expect(output.trim()).toBe("Hello from Bun");
    });

    test("Bun.spawn() captures stderr", async () => {
      // Create a command that writes to stderr
      const proc = Bun.spawn(["sh", "-c", "echo 'error message' >&2"], {
        stderr: "pipe",
      });

      const stderr = await new Response(proc.stderr).text();
      expect(stderr.trim()).toBe("error message");
    });

    test("Bun.spawn() with cwd option", async () => {
      const proc = Bun.spawn(["pwd"], {
        cwd: testDir,
      });

      const output = await new Response(proc.stdout).text();
      // On macOS, /tmp is symlinked to /private/tmp, so we check if paths match or are equivalent
      const normalized = output.trim().replace(/^\/private/, "");
      const expectedNormalized = testDir.replace(/^\/private/, "");
      expect(normalized).toBe(expectedNormalized);
    });

    test("Bun.spawn() handles command failures", async () => {
      const proc = Bun.spawn(["false"]);
      await proc.exited;

      expect(proc.exitCode).not.toBe(0);
    });
  });

  describe("Crypto operations", () => {
    test("Bun.hash() generates hashes", () => {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update("test data");
      const hash = hasher.digest("hex");

      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64); // SHA256 produces 64 hex characters
    });

    test("Bun.hash() is consistent", () => {
      const hasher1 = new Bun.CryptoHasher("sha256");
      hasher1.update("consistent");
      const hash1 = hasher1.digest("hex");

      const hasher2 = new Bun.CryptoHasher("sha256");
      hasher2.update("consistent");
      const hash2 = hasher2.digest("hex");

      expect(hash1).toBe(hash2);
    });

    test("Bun.hash() supports different algorithms", () => {
      const sha256 = new Bun.CryptoHasher("sha256");
      sha256.update("data");
      const hash256 = sha256.digest("hex");

      const sha512 = new Bun.CryptoHasher("sha512");
      sha512.update("data");
      const hash512 = sha512.digest("hex");

      expect(hash256.length).toBe(64);
      expect(hash512.length).toBe(128);
    });
  });

  describe("Environment and system info", () => {
    test("Bun.env provides environment variables", () => {
      const path = Bun.env.PATH;
      expect(path).toBeDefined();
      expect(typeof path).toBe("string");
    });

    test("process.cwd() returns current directory", () => {
      const cwd = process.cwd();
      expect(cwd).toBeDefined();
      expect(typeof cwd).toBe("string");
    });

    test("import.meta.dir provides file directory", () => {
      const dir = import.meta.dir;
      expect(dir).toBeDefined();
      expect(typeof dir).toBe("string");
      expect(dir.includes("__tests__")).toBe(true);
    });
  });

  describe("Path operations", () => {
    test("path concatenation works with join", () => {
      // While we'll move to using template literals where possible,
      // join from node:path still works and is sometimes needed for
      // cross-platform compatibility
      const fullPath = join(testDir, "subdir", "file.txt");
      expect(fullPath).toContain("subdir");
      expect(fullPath).toContain("file.txt");
    });

    test("path.resolve alternatives", () => {
      // Bun can use import.meta.resolve() for module resolution
      // but for file paths, we can still use path utilities or template literals
      const base = "/home/user";
      const relative = "documents/file.txt";
      const absolute = `${base}/${relative}`;

      expect(absolute).toBe("/home/user/documents/file.txt");
    });
  });
});
