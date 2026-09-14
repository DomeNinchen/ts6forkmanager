import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export interface YouTubeInfo {
  id: string;
  title: string;
  artist: string;
  duration: number; // seconds
  thumbnail: string;
  url: string;
}

export interface YouTubeSearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

// Shared cookie file path (set from settings)
let ytCookieFile: string | null = null;

export function setYtCookieFile(filePath: string | null): void {
  ytCookieFile = filePath;
}

export function getYtCookieFile(): string | null {
  return ytCookieFile;
}

export function getCookieArgs(): string[] {
  const args: string[] = ["--remote-components", "ejs:github"];
  if (ytCookieFile) {
    args.push("--cookies", ytCookieFile);
  }
  return args;
}

/**
 * Whether the configured cookie file is still actually accepted by YouTube,
 * not just present on disk. Google/YouTube auth cookies rotate over time;
 * yt-dlp tries to write rotated values back to the same file, but that only
 * keeps working if this file stays the one live session touching it - a
 * snapshot re-exported once and never revisited can quietly go stale while
 * still sitting there as a normal-looking file. Tests by requesting the
 * account's own "Watch Later" playlist (`list=WL`), which only resolves at
 * all when logged in as that account - confirmed for real (no cookies at
 * all): yt-dlp fails with "YouTube said: The playlist does not exist.",
 * distinct from any other kind of failure.
 */
export function checkCookiesValid(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ytCookieFile) return resolve(false);

    const proc = spawn("yt-dlp", [
      ...getCookieArgs(),
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      "--playlist-items", "1",
      "https://www.youtube.com/playlist?list=WL",
    ], { shell: false });

    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Download audio from a YouTube URL using yt-dlp
 */
export function downloadYouTube(url: string, outputDir: string): Promise<{ filePath: string; info: YouTubeInfo }> {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");

    // First get info
    const infoProc = spawn("yt-dlp", [
        ...getCookieArgs(),
        "--dump-json",
      "--no-playlist",
      url,
    ], { shell: false });

    let infoJson = "";
    let infoErr = "";
    infoProc.stdout.on("data", (chunk: Buffer) => {
      infoJson += chunk.toString();
    });
    infoProc.stderr.on("data", (chunk: Buffer) => {
      infoErr += chunk.toString();
    });

    infoProc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp info failed (code ${code}): ${infoErr.slice(0, 200)}`));
      }

      let parsed: any;
      try {
        parsed = JSON.parse(infoJson);
      } catch {
        return reject(new Error("Failed to parse yt-dlp output"));
      }

      const info: YouTubeInfo = {
        id: parsed.id,
        title: parsed.title || "Unknown",
        artist: parsed.uploader || parsed.channel || "Unknown",
        duration: parsed.duration || 0,
        thumbnail: parsed.thumbnail || "",
        // parsed.webpage_url is the real, resolved video URL - falls back to
        // the input only if yt-dlp somehow didn't report it. Matters when
        // `url` was a ytsearch:... query rather than an actual link.
        url: parsed.webpage_url || url,
      };

      const expectedPath = path.join(outputDir, `${info.id}.opus`);

      // Check if already downloaded
      if (fs.existsSync(expectedPath)) {
        return resolve({ filePath: expectedPath, info });
      }

      // Download audio only
      const dlProc = spawn("yt-dlp", [
        ...getCookieArgs(),
        "-x",                       // extract audio
        "--audio-format", "opus",   // opus format (native for TS3)
        "--audio-quality", "0",     // best quality
        "--no-playlist",
        "-o", outputTemplate,
        url,
      ], { shell: false });

      let dlErr = "";
      dlProc.stderr.on("data", (chunk: Buffer) => {
        dlErr += chunk.toString();
      });

      dlProc.on("close", (dlCode) => {
        if (dlCode !== 0) {
          return reject(new Error(`yt-dlp download failed (code ${dlCode}): ${dlErr.slice(0, 200)}`));
        }

        // yt-dlp may use different extensions, find the actual file
        const files = fs.readdirSync(outputDir).filter((f) => f.startsWith(info.id));
        if (files.length === 0) {
          return reject(new Error("Downloaded file not found"));
        }

        const filePath = path.join(outputDir, files[files.length - 1]);
        resolve({ filePath, info });
      });

      dlProc.on("error", (err) => {
        reject(new Error(`yt-dlp not found: ${err.message}`));
      });
    });

    infoProc.on("error", (err) => {
      reject(new Error(`yt-dlp not found: ${err.message}`));
    });
  });
}

/**
 * Get info about a YouTube URL (single video or playlist).
 * Returns type ('video' or 'playlist') and array of items.
 */
export function getYouTubeUrlInfo(url: string): Promise<{ type: 'video' | 'playlist'; items: YouTubeSearchResult[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
        ...getCookieArgs(),
        "--dump-json",
      "--flat-playlist",
      "--no-download",
      url,
    ], { shell: false });

    let output = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp info failed (code ${code}): ${stderr.slice(0, 200)}`));
      }

      try {
        const lines = output.trim().split("\n").filter(Boolean);
        const items: YouTubeSearchResult[] = lines.map((line) => {
          const parsed = JSON.parse(line);
          return {
            id: parsed.id,
            title: parsed.title || "Unknown",
            artist: parsed.uploader || parsed.channel || "Unknown",
            duration: parsed.duration || 0,
            thumbnail: parsed.thumbnails?.[0]?.url || parsed.thumbnail || "",
          };
        });

        const type = items.length > 1 ? 'playlist' : 'video';
        resolve({ type, items });
      } catch {
        reject(new Error("Failed to parse yt-dlp output"));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`yt-dlp not found: ${err.message}`));
    });
  });
}

/**
 * Search YouTube using yt-dlp
 */
export function searchYouTube(query: string, maxResults: number = 10): Promise<YouTubeSearchResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
        ...getCookieArgs(),
        `ytsearch${maxResults}:${query}`,
      "--dump-json",
      "--flat-playlist",
      "--no-download",
    ], { shell: false });

    let output = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp search failed (code ${code}): ${stderr.slice(0, 200)}`));
      }

      try {
        // yt-dlp outputs one JSON object per line
        const results = output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const parsed = JSON.parse(line);
            return {
              id: parsed.id,
              title: parsed.title || "Unknown",
              artist: parsed.uploader || parsed.channel || "Unknown",
              duration: parsed.duration || 0,
              thumbnail: parsed.thumbnails?.[0]?.url || "",
            };
          });

        resolve(results);
      } catch {
        resolve([]);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`yt-dlp not found: ${err.message}`));
    });
  });
}
