# Component Catalog

## Web portal

| Area | Main route/page | Reusable/UI evidence |
|---|---|---|
| Authentication | Login, ForgotPassword | `pages/Login`, `pages/ForgotPassword`, `services/authApi.ts` |
| Dashboard/monitoring | `/dashboard`, `/monitoring` | Dashboard feature components, `usePond`, telemetry socket hooks |
| Farm/pond | `/farms`, Profile managed ponds | `pages/Farm_Management`, `features/Farms`, `features/Ponds` |
| Devices | `/devices` | `pages/Sensors_Devices`, device drawer/components |
| Alerts/AI | `/alerts`, `/ai-analysis` | Alerts History and AI Analysis features |
| Staff | `/staff` | Staff table/card/form/assignment modals and `useStaff` |
| Profile | `/profile/*`, `/settings` | Profile layout, personal/security/preferences/managed ponds |

Shared components include navigation, title, cards/charts and confirmation/dialog UI. Reuse these before creating a parallel page/modal.

## Mobile

`AppNavigator` gates Auth/ForceChangePassword/Main; `MainTabNavigator` provides Overview, Ponds, Analytics, Alerts and Settings. Screens provide device, pond detail, alert center, dashboard, profile/settings and auth flows. Redux slices include auth, pond and alert state; use existing API/socket services rather than adding raw requests.
