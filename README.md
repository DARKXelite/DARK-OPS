# DARK-OPS

Operations platform for Clover Greens Golf Resort.

## Project status

The repository is being initialized around the existing single-page Clover Greens Ops dashboard. The first objective is to preserve current behavior and establish a safe baseline before incremental modularization.

## Architecture direction

- **Frontend:** Single-page application with modular JavaScript and CSS.
- **Firebase:** Existing Firebase project and Firestore data model. Preserve current configuration, collection names, listeners, and access rules unless a reviewed change explicitly requires otherwise.
- **Modules:** Dashboard, Fleet Ops, Fuel Ops, Turf Ops, Inventory, Users, Maintenance & Records, and shared analytics.
- **Workflow:** Feature branches, focused commits, syntax checks, and pull requests. Keep `main` stable.
- **Safety:** Never commit service-account keys, private credentials, or real secrets.

## Source baseline

Preserve the current dashboard as a reference before refactoring. The migration must keep the production dashboard intact while new modules are introduced and compared.

## Development principles

1. Make behavior-preserving changes first.
2. Keep Firestore access centralized and auditable.
3. Distinguish planned, issued, and verified quantities.
4. Keep operational and cost calculations traceable to source records.
5. Verify with tests and realistic data before deployment.

## Current limitations

The connected GitHub integration supports creating and updating repository files and branches, but does not expose a new-repository creation action in this session. This project uses the existing private `DARKXelite/DARK-OPS` repository.
