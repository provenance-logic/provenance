/**
 * Router-state contract for the "Create data product from a discovered source"
 * journey (B-075 Surface 1, Tier A).
 *
 * The connector detail page can't bind a port to a source directly — the port
 * (and the product it lives on) don't exist yet at click time. So instead of a
 * single-form prefill, we thread the chosen source's identity through the two
 * authoring stages via react-router location state:
 *
 *   ConnectorDetailPage  --(navigate, state)-->  NewProductForm
 *                        --(navigate, state)-->  ProductDetail (port form prefilled)
 *
 * Each hop reads `bindSource` off `location.state`. When absent, both pages
 * behave exactly as before — this state is purely additive.
 */
export interface SourceBindingNavState {
  /**
   * When present, the destination should pre-bind a new output port to this
   * discovered source object. All fields are display- or wiring-only; the
   * authoritative binding is the `sourceRegistrationId` FK the backend records
   * on the port (V33 / ProductEnrichmentService).
   */
  bindSource?: {
    /** Connector the source was discovered through — pre-selects the binding picker's connector dropdown. */
    connectorId: string;
    /** Source registration to bind the port to (the FK persisted on the port). */
    sourceRegistrationId: string;
    /** Default object path (the source's `sourceRef`, e.g. `public.orders`); the producer can override. */
    sourceObjectPath: string;
    /** Human-readable source name for the confirmation banner. */
    sourceDisplayName: string;
    /** Human-readable connector name for the confirmation banner. */
    connectorName: string;
  };
}
