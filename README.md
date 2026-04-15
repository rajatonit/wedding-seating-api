# 💍 Wedding Seating API (v2 — Google SSO)

REST API + frontend for a wedding reception seating chart.
**MongoDB Atlas M0** (free) · **Render.com** (free) · **Google Sign-In** (free)

---

## How It Works

- Guests visit the site → see the seating map, search their name
- Admin clicks ⚙ → **Sign in with Google** button appears
- Google verifies identity → API checks email matches `ADMIN_EMAIL` → issues an 8-hour JWT session token
- Admin manages tables and guests; all changes write to MongoDB Atlas

---

## Full Setup Guide

### Step 1 — MongoDB Atlas

1. Sign up at [cloud.mongodb.com](https://cloud.mongodb.com) (free)
2. Create a **free M0 cluster** (any region)
3. **Database Access** → Add user `wedding-api` with password, role: **Read & Write to any database**
4. **Network Access** → Add IP `0.0.0.0/0` (allow all — Render uses dynamic IPs)
5. **Connect → Drivers → Node.js** → copy the connection string, fill in `<password>`

```
mongodb+srv://@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

---

### Step 2 — Google OAuth Client ID

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
4. Application type: **Web application**
5. Under **Authorised JavaScript origins**, add:
   - `http://localhost:3000` (for local dev)
   - Your frontend URL e.g. `https://my-wedding.netlify.app`
6. Under **Authorised redirect URIs** — leave empty (we use the implicit credential callback, no redirect needed)
7. Click **Create** — copy the **Client ID** (looks like `123456789-abc.apps.googleusercontent.com`)

> You do NOT need a Client Secret — Google Sign-In uses ID tokens, not OAuth code flow.

---

### Step 3 — Push to GitHub

```bash
git init
git add .
git commit -m "Wedding seating API v2"
# Create repo on github.com, then:
git remote add origin https://github.com/YOU/wedding-seating-api.git
git branch -M main
git push -u origin main
```

---

### Step 4 — Deploy on Render.com (free)

1. [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Settings:

   | Field         | Value         |
   | ------------- | ------------- |
   | Runtime       | Node          |
   | Build Command | `npm install` |
   | Start Command | `npm start`   |
   | Instance Type | **Free**      |

4. **Environment Variables:**

   | Key                | Value                                                   |
   | ------------------ | ------------------------------------------------------- |
   | `MONGO_URI`        | Your Atlas connection string                            |
   | `JWT_SECRET`       | Run `openssl rand -hex 32` and paste the output         |
   | `GOOGLE_CLIENT_ID` | Your OAuth Client ID from Step 2                        |
   | `ADMIN_EMAIL`      | Your Google account email (the admin)                   |
   | `DB_NAME`          | `wedding`                                               |
   | `COLLECTION`       | `seating`                                               |
   | `ALLOWED_ORIGINS`  | Your frontend URL e.g. `https://my-wedding.netlify.app` |

5. Deploy → note your service URL: `https://wedding-seating-api-xxxx.onrender.com`

---

### Step 5 — Configure the Frontend

Open `wedding-seating.html` and update the two constants at the top of the `<script>`:

```javascript
const API_BASE = 'https://wedding-seating-api-xxxx.onrender.com'; // ← your Render URL
const GOOGLE_CLIENT_ID = '123456789-abc.apps.googleusercontent.com'; // ← from Step 2
```

Then host the HTML file anywhere static:

- [Netlify Drop](https://app.netlify.com/drop) — just drag the file, instant URL
- GitHub Pages
- Vercel

Make sure the frontend URL is in your Google OAuth **Authorised JavaScript origins**.

---

### Step 6 — Keep Render warm (optional)

Render free tier sleeps after 15 min idle. Use [UptimeRobot](https://uptimerobot.com) (free):

- Monitor type: **HTTP(s)**
- URL: `https://your-api.onrender.com/health`
- Interval: **14 minutes**

---

## API Reference

| Method   | Path                                  | Auth | Description                            |
| -------- | ------------------------------------- | ---- | -------------------------------------- |
| `GET`    | `/health`                             | None | Liveness check                         |
| `POST`   | `/auth/google`                        | None | Exchange Google ID token → JWT session |
| `GET`    | `/auth/me`                            | JWT  | Validate session                       |
| `GET`    | `/api/seating`                        | None | Full seating data (public)             |
| `PUT`    | `/api/seating`                        | JWT  | Replace entire document                |
| `PATCH`  | `/api/seating/config`                 | JWT  | Update config fields                   |
| `POST`   | `/api/seating/tables`                 | JWT  | Add table                              |
| `PUT`    | `/api/seating/tables/:id`             | JWT  | Update table                           |
| `DELETE` | `/api/seating/tables/:id`             | JWT  | Delete table                           |
| `POST`   | `/api/seating/tables/:id/guests`      | JWT  | Add guest                              |
| `DELETE` | `/api/seating/tables/:id/guests/:gid` | JWT  | Remove guest                           |
| `GET`    | `/api/seating/search?q=`              | None | Search guests by name                  |

**Auth header:** `Authorization: Bearer <jwt_token>`

---

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your values
npm run dev
```

API runs on `http://localhost:3000`.

For the frontend, open `wedding-seating.html` in a browser. Set `API_BASE = "http://localhost:3000"` temporarily.
