import { useMemo } from 'react';

import { IntlTransitReportPresenter } from './model/intl-transit-report-presenter';
import { MercatorRouteGeometry } from './model/mercator-route-geometry';
import type { RouteGeometry } from './model/route-geometry';
import type { TransitReportPresentation } from './model/transit-report-presentation';

/** The texts of the transit report. */
export function useTransitReportPresenter(): TransitReportPresentation {
  return useMemo(() => new IntlTransitReportPresenter(), []);
}

/** Where the transit report's route goes on the map. */
export function useRouteGeometry(): RouteGeometry {
  return useMemo(() => new MercatorRouteGeometry(), []);
}
