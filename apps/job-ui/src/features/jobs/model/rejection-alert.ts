export interface MessageRejectionAlertRequest {
  /** The error the API call failed with. */
  readonly error: Error;
  /** How many form fields now show one of the rejection's issues. */
  readonly fieldCount: number;
  /** Messages of the rejection's issues that match no field. */
  readonly unmatched: readonly string[];
}
export interface MessageRejectionAlertResponse {
  /** The alert above the buttons, or `null` when the fields already say everything. */
  readonly message: string | null;
}

/**
 * What a job form's alert says when the API rejects a submit: issues that fit no field, else the
 * error's own message unless the issues are all shown on fields, so the user always learns why.
 */
export interface RejectionAlert {
  message(req: MessageRejectionAlertRequest): MessageRejectionAlertResponse;
}
