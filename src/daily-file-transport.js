"use strict";
// Winston transport that always writes to the same file (application.log) and rotates it once a day:
// the previous day's lines move to <name>-YYYY-MM-DD.log.gz and archives older than `retentionDays` are deleted.
// The day is the server's local date. Meant for a single process writing the file (supervisor runs one)
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const winston = require("winston");

const ROTATE_CHECK_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// The formatted line winston hands to transports (triple-beam's MESSAGE)
const MESSAGE = Symbol.for("message");

// Local date as YYYY-MM-DD
const day = (date = new Date()) => date.toLocaleDateString("en-CA");

// The logger can't log its own failures, so they go to stderr (the supervisor log)
const reportFailure = (message, err) => {
  process.stderr.write(`${JSON.stringify({ levelname: "ERROR", message, error: err.message })}\n`);
};

class DailyFileTransport extends winston.Transport {
  constructor({ filename, retentionDays, ...options }) {
    super(options);
    this.filename = filename;
    this.retentionDays = retentionDays;
    this.base = path.basename(filename, path.extname(filename));
    fs.mkdirSync(path.dirname(filename), { recursive: true });

    // A file left from an earlier day (the server was down at midnight) is archived under the day it was last written
    this.day = fs.existsSync(filename) ? day(fs.statSync(filename).mtime) : day();
    this.rotateIfNewDay();
    this.stream = this.stream || fs.createWriteStream(filename, { flags: "a" });

    // Also rotates on days with no log lines; unref so the timer never keeps the process alive
    this.timer = setInterval(() => this.rotateIfNewDay(), ROTATE_CHECK_MS).unref();
  }

  log(info, callback) {
    this.rotateIfNewDay();
    this.stream.write(`${info[MESSAGE]}\n`, () => {
      this.emit("logged", info);
      callback();
    });
  }

  rotateIfNewDay() {
    const today = day();
    if (today === this.day) return;

    const archive = this.archivePath(this.day);
    this.day = today;
    // Renaming keeps an open stream pointing at the moved file, so its pending writes still land in the archive.
    // Rename and reopen are synchronous, so no line is written between them
    try {
      fs.renameSync(this.filename, archive);
    } catch (err) {
      // ENOENT: the file was deleted, so there is nothing to archive. Otherwise keep writing to the current file
      if (err.code !== "ENOENT") reportFailure("Failed to rotate the log file.", err);
      return;
    }
    const previous = this.stream;
    this.stream = fs.createWriteStream(this.filename, { flags: "a" });

    const archiveAndClean = () => {
      this.compress(archive)
        .then(() => this.deleteOldArchives())
        .catch((err) => reportFailure("Failed to compress or clean up rotated log files.", err));
    };
    // At startup there is no stream yet; otherwise the old one finishes its pending writes first
    if (previous) previous.end(archiveAndClean);
    else archiveAndClean();
  }

  // <name>-YYYY-MM-DD.log, with -1, -2, ... when that day already has an archive (the day was rotated before)
  archivePath(date) {
    const dir = path.dirname(this.filename);
    let candidate = path.join(dir, `${this.base}-${date}.log`);
    for (let n = 1; fs.existsSync(candidate) || fs.existsSync(`${candidate}.gz`); n++) {
      candidate = path.join(dir, `${this.base}-${date}-${n}.log`);
    }
    return candidate;
  }

  async compress(file) {
    await pipeline(fs.createReadStream(file), zlib.createGzip(), fs.createWriteStream(`${file}.gz`));
    await fs.promises.unlink(file);
  }

  async deleteOldArchives() {
    const dir = path.dirname(this.filename);
    const pattern = new RegExp(`^${this.base}-(\\d{4}-\\d{2}-\\d{2})(-\\d+)?\\.log\\.gz$`);
    const oldest = day(new Date(Date.now() - this.retentionDays * DAY_MS));
    for (const file of await fs.promises.readdir(dir)) {
      const match = pattern.exec(file);
      if (match && match[1] < oldest) await fs.promises.unlink(path.join(dir, file));
    }
  }

  close() {
    clearInterval(this.timer);
    this.stream.end(() => this.emit("finish"));
  }
}

module.exports = DailyFileTransport;
