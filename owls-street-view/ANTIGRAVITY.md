# Owl Street View — ANTIGRAVITY Package Guide 💻

This is the local entry point for the **View Trading Dashboard & Option Matrix** service.

## Local Configuration

All specifications for this package live in:
* **[progress.md](./progress.md)**: Tracks completed and pending dashboard features.
* **[ai_specs/overview.md](./ai_specs/overview.md)**: High-level overview of the trading proxy and React application.
* **[ai_specs/features.md](./ai_specs/features.md)**: Option matrix, stock screener, and charting interfaces.
* **[ai_specs/architecture.md](./ai_specs/architecture.md)**: Frontend components, FastAPI routes, and styles.
* **[ai_specs/deployment.md](./ai_specs/deployment.md)**: Building frontend assets and launching servers.

## Common Development Commands

### Full Startup (Backend + Compiled Frontend)
Compiles React code into static build files, installs requirements, and runs the FastAPI backend server:
```bash
./run.sh
```

### Hot-Reload Frontend Development (HMR)
Recommended for active React UI updates:
1. Run the FastAPI proxy server in terminal window 1:
   ```bash
   ./run.sh
   ```
2. Launch the Vite/ESBuild development server in terminal window 2:
   ```bash
   cd frontend
   npm start
   ```
   *Note: React scripts are preconfigured to proxy API operations to the backend on port 8080.*

### Compile Frontend Static Bundle
Manually compile the React bundle output inside `frontend/build/`:
```bash
cd frontend
npm run build
```
