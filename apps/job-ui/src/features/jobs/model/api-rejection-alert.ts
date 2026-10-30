import { ApiError } from '../api/api-error';
import type {
  MessageRejectionAlertRequest,
  MessageRejectionAlertResponse,
  RejectionAlert,
} from './rejection-alert';

/** `RejectionAlert` for `ApiError`: only a `VALIDATION_FAILED` answer can have issues on fields. */
export class ApiRejectionAlert implements RejectionAlert {
  message(req: MessageRejectionAlertRequest): MessageRejectionAlertResponse {
    const validation = req.error instanceof ApiError && req.error.code === 'VALIDATION_FAILED';
    if (!validation) return { message: req.error.message };
    if (req.unmatched.length > 0) return { message: req.unmatched.join(' ') };
    return { message: req.fieldCount === 0 ? req.error.message : null };
  }
}
