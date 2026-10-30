import { createContext } from 'react';

import { UI_CONFIG, type UiConfig } from './ui-config';

export const UiConfigContext = createContext<UiConfig>(UI_CONFIG);
