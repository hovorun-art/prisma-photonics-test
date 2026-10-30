export interface FormatWholeNumberFormatRequest {
  readonly value: number;
}
export interface FormatWholeNumberFormatResponse {
  readonly text: string;
}

/** A number rounded to a whole one, with thousands grouped, e.g. `5,540`. */
export interface WholeNumberFormat {
  format(req: FormatWholeNumberFormatRequest): FormatWholeNumberFormatResponse;
}

/** `WholeNumberFormat` with the `en-GB` grouping job-ui shows. */
export class IntlWholeNumberFormat implements WholeNumberFormat {
  private readonly number = new Intl.NumberFormat('en-GB');

  format({ value }: FormatWholeNumberFormatRequest): FormatWholeNumberFormatResponse {
    return { text: this.number.format(Math.round(value)) };
  }
}
