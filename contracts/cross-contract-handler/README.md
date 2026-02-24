# Cross-Contract Communication Handler

Platform-core contract for routing and tracking cross-contract requests. Admin registers routes (source → target + selector); authorized callers dispatch requests; targets (or admin) acknowledge with results.

## Methods

| Method | Description | Authorization |
|--------|-------------|---------------|
| `init(admin, registry_contract)` | Initialize handler. Call once. | `admin` (require_auth) |
| `register_route(admin, source_contract, target_contract, selector)` | Register a route; returns `route_id`. | Admin only |
| `dispatch(caller, request_id, route_id, payload)` | Create a pending request on a route. | `caller` must authorize and be admin or `source_contract` for that route |
| `acknowledge(caller, request_id, result)` | Mark request as completed with a result. | `caller` must authorize and be admin or `target_contract` for that request's route |
| `get_route(route_id)` | Read route data. | Anyone (view) |

## Storage

- **Instance:** `Admin`, `RegistryContract`, `NextRouteId`, `Route(u32)`, `Request(Symbol)`.
- **Routes:** Stored by auto-incrementing `route_id` (1, 2, …).
- **Requests:** Keyed by caller-provided `request_id` (Symbol). Status: `Pending { route_id, payload }` or `Acknowledged { result }`.

## Events

- `Initialized { admin, registry_contract }`
- `RouteRegistered { route_id, source_contract, target_contract, selector }`
- `Dispatched { request_id, route_id, payload }`
- `Acknowledged { request_id, result }`

## Invariants

- `source_contract` and `target_contract` must differ for a route.
- A given `request_id` can only be dispatched once (no duplicate processing).
- A request can only be acknowledged once (no double acknowledge).
- Only admin or the route’s source can dispatch; only admin or the route’s target can acknowledge.

## Integration

- Dependent contracts should call this handler to register routes and dispatch/acknowledge requests.
- The `registry_contract` stored at init can be used by off-chain or other contracts to resolve contract addresses.
- For pause/emergency behavior, integrate with the platform’s emergency-pause contract where applicable.
