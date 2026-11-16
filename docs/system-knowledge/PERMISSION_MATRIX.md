# Permission Matrix

Backend guards and service scoping are authoritative; portal UI checks are advisory.

| Area | ADMIN | MANAGER | FARMER |
|---|---|---|---|
| Farm create/update/delete/assign/revoke manager | Yes | No | No |
| Farm read | All | Owned farm | No route evidence |
| Pond/device config | All | Owned-farm scope | Read scoped only |
| Farmer pond assignment/revocation | All | Owned-farm scope, farmer target | No |
| User CRUD/unlock | All | Scoped non-admin user | Own profile/read only |
| Device fault report | Yes | Scoped | Assigned/owned pond |
| Alert read/resolve | All | Owned-farm scope | Assigned/owned pond |
| Prediction latest/history/trigger | All scoped by pond read rules; trigger yes | Owned-farm scope; trigger yes | Assigned-pond read only; no trigger |
| Crops write | Service permits scoped manager path | Yes | Read scope only |

Known UI mismatch: portal `canManageUser` only excludes ADMIN for Manager and cannot itself prove farm membership; backend must remain enforcement point. Exact every-method role behavior is in controller/service source and requires API integration testing.

### AQS-102 verification

An isolated browser/API test reproduced a Manager reading another Manager’s prediction history, then verified the corrected Core endpoint returns **403**. UI pond selection also excluded the foreign pond. This does not replace backend authority checks; it verifies that the prediction controller now invokes them.
