# Vendo

## Overview
Vendo is a chat-first customer order and credit management platform tailored for small kirana stores. It combines secure onboarding, real-time messaging, and embedded audio/video calling to keep retailers connected with their customers while tracking transactions. Upcoming iterations will introduce symmetric encryption for sensitive payloads and an end-to-end ordering workflow.

## Core Features
- **JWT Authentication** with HTTP-only cookies for session security
- **Role-neutral Access Control** via reusable Express middleware
- **SQLite Persistence** with automatic schema bootstrapping
- **Real-time Chat** powered by Socket.IO with multi-device session tracking
- **WebRTC Audio/Video Calls** with TURN/STUN fallbacks for reliable connectivity
- **Client-side Message Cache** using SQL.js for offline continuity
- **Extensible Service Modules** for auth, chat, and setup flows

## Project Structure
```
app.js                 # Express entrypoint and Socket.IO wiring
authservice/           # Authentication controllers, routes, and DB connector
chat/                  # WebSocket event handlers for messaging & signaling
Middleware/            # Authentication, error handling, and logging hooks
public/                # Browser client (HTML/CSS/JS) and WebRTC UI
setup/                 # Onboarding utilities (contact lookup, etc.)
Dockerfile             # Container build definition
```

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment**
   - Create a `.env` file (optional) and define:
     - `PORT` (default `3000`)
     - `JWT_SECRET` for signing tokens
   - Update `SECRET_KEY` references to `process.env.JWT_SECRET` before production.
3. **Run the server**
   ```bash
   node app.js
   ```
4. **Access the app** at `http://localhost:3000` to reach the temporary landing page and sign-in flow.

## Authentication Service
| Method | Endpoint              | Description                                  |
|--------|-----------------------|----------------------------------------------|
| POST   | `/authservice/signup` | Create a user with `username` and `password` |
| POST   | `/authservice/signin` | Authenticate and set HTTP-only JWT cookie    |
| GET    | `/authservice/delete` | Delete the authenticated user                |
| GET    | `/authservice/check`  | Validate the current JWT session             |

### JWT Flow
- Passwords are hashed with bcrypt before storage.
- Successful sign-in issues a 1-hour token stored in an HTTP-only cookie.
- `Middleware/authentication.js` verifies tokens for protected routes.
- `Middleware/socketauth.js` reuses the same token for Socket.IO handshakes.

## Realtime Messaging
- Socket namespace: default (`/`)
- Events emitted by client
  - `message`: `{ to, text }` routes messages to recipient sockets
  - `webrtc-signal`: `{ to, signal }` exchanges SDP offers/answers and ICE candidates
- Events emitted by server
  - `message`: `{ from, fromUsername, text }`
  - `webrtc-signal`: `{ from, signal }`

Client-side chat history is persisted locally via SQL.js (max 50 messages per contact) for quick recall after reloads.

## WebRTC Calling
- Audio-only by default with toggle for audio+video
- STUN: `stun.l.google.com:19302`
- TURN: `global.relay.metered.ca`
- Call states (`idle`, `ringing`, `in-call`) synchronize UI buttons and stream lifecycle

## Database
- SQLite database stored at `./db.db`
- Schema is auto-created:
  ```sql
  CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    hashedPassword TEXT NOT NULL
  );
  ```
- Future migrations should be versioned to prevent implicit schema drift across environments.

## Frontend Highlights
- Responsive layout with split sidebar/chat pane
- Contact discovery via `/getcontact?username=<query>`
- Message notifications for background conversations
- Local storage of JWT token for reconnection support

## Development Workflow & Git Guidelines
1. **Branch Strategy**
   - Create feature branches from `main` following `feature/<short-description>` naming.
   - Use `fix/` and `chore/` prefixes for bug fixes and maintenance respectively.
2. **Commits**
   - Prefer conventional messages (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
   - Keep commits scoped: one logical change per commit.
3. **Pull Requests**
   - Rebase onto the latest `main` before opening a PR.
   - Provide a concise summary, testing notes, and screenshots/GIFs for UI changes.
   - Request review from a teammate; avoid self-merging without approval.
4. **Quality checks**
   - Add automated tests and linters as the project matures; document required commands in this README for consistency.

## Deployment
- **Docker**: Build using `docker build -t vendo .` and run with `docker run -p 3000:3000 vendo`.
- Ensure environment variables are injected securely (e.g., Docker secrets, orchestrator config).
- Terminate TLS at a reverse proxy (Nginx, Traefik) to enable HTTPS for WebRTC.

## Roadmap
- Implement symmetric encryption for message payloads at rest and in transit.
- Build the ordering workflow (catalog, cart, invoicing, credit tracking).
- Integrate role-based access control for shop staff.
- Add automated tests (`npm test`) and linting (`npm run lint`).
- Replace hard-coded secrets with environment-driven configuration.

## Troubleshooting
1. **Socket connection fails**: confirm JWT cookie is present and not expired.
2. **WebRTC call doesn’t connect**: verify camera/mic permissions and TURN server reachability.
3. **Database locked errors**: close long-running connections or increase SQLite busy timeout.

## License
ISC © yashwanth