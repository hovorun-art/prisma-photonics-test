import type {
  MaskTextMaskRequest,
  MaskTextMaskResponse,
  TextMask,
} from '../../domain/masking/text-mask.js';

export interface PatternTextMaskParams {
  homeDir: string;
  email: string | undefined;
}

/** Shapes of real secrets; the repository's documented dev and test tokens match none of them. */
const SECRETS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Replaces the home path with `~`, the git user's email with `<email>` and secrets with `<redacted>`. */
export class PatternTextMask implements TextMask {
  constructor(private readonly p: PatternTextMaskParams) {}

  mask(req: MaskTextMaskRequest): MaskTextMaskResponse {
    let text = req.text.split(this.p.homeDir).join('~');
    if (this.p.email !== undefined) text = text.split(this.p.email).join('<email>');
    for (const secret of SECRETS) text = text.replace(secret, '<redacted>');
    return { text };
  }
}
