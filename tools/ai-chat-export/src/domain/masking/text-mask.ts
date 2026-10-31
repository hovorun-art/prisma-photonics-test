/** Hides personal data and secrets in exported text. */
export interface TextMask {
  mask(req: MaskTextMaskRequest): MaskTextMaskResponse;
}

export interface MaskTextMaskRequest {
  text: string;
}

export interface MaskTextMaskResponse {
  text: string;
}
