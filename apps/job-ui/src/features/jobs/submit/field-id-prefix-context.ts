import { createContext } from 'react';

/**
 * Prefix of the element ids of a form's fields (`<prefix>-payload.to`). A page with several job
 * forms at once gives each its own, so labels and error messages point at their own form.
 */
export const FieldIdPrefixContext = createContext('field');
