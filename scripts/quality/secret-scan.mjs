import { repositoryFiles, textFile } from "./repository-files.mjs";

/** @type {Array<[string, RegExp]>} */
const signatures = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["Resend API key", /\bre_[A-Za-z0-9_]{20,}\b/],
  ["Stripe secret key", /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
];

const findings = [];
for (const path of repositoryFiles({ includeUntracked: true })) {
  const text = textFile(path);
  if (text === null) continue;
  for (const [name, pattern] of signatures) {
    if (pattern.test(text)) findings.push(`${path}: ${name}`);
  }
  for (const match of text.matchAll(/\+[1-9][0-9]{7,14}/g)) {
    if (!/^\+1555(?:00000|55501)[0-9]+$/.test(match[0])) {
      findings.push(`${path}: possible real E.164 contact`);
    }
  }
}

if (findings.length) {
  console.error("Secret scan failed (values are intentionally not printed):");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("Secret scan passed: no known credential signatures found.");
}
