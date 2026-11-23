# Direct WBW connection

Dan uses Bootlister’s existing import tools to collect a seller’s current marketplace inventory, then sends it straight to that seller’s WBW profile. No CSV handoff or seller password is needed.

## Use

1. Sign into Bootlister as staff and choose the seller. Save their display name, login email and location in Seller settings. Record import and photo permission in Seller intake.
2. Import the seller’s listings using the existing website, marketplace, extension or List Perfectly tools.
3. Select listings. **Send to WBW as drafts** creates/connects their WBW account and uploads the inventory and photos.
4. To publish, approve the listings, choose **WBW shipping**, then use **List on WBW**. An item that fails WBW’s required-field, media-moderation or restricted-skin checks stays a draft with a reason.

**Connect seller to WBW** also works without uploading listings. Account badges refresh from actual WBW signup, approval and phone records. Connection does not invent verification or consent. Each transferred item shows its WBW pair ID, last-confirmed status and date. The existing “Exported” tab is local Bootlister state; it does not prove a pair is live on WBW.

## Server setup

The WBW receiver and its migration must be deployed first. Set `WBW_API_KEY` as a private environment variable on this Bootlister project, then redeploy. It is a dedicated WBW integration key starting `wbw_bl_`, not a Supabase key, WBW password, browser token or `NEXT_PUBLIC_` variable.

WBW stores the matching SHA-256 key digest in `BOOTLISTER_API_KEY_SHA256` and Dan’s confirmed WBW user UUID in `BOOTLISTER_ADMIN_USER_ID`. WBW checks his current admin role and Terms acceptance on each request. Staff may publish managed inventory without having the seller sign in or verify a phone; this does not set anyone’s phone-verification badge. WBW’s existing seller self-publication gates are unchanged.

Use WBW’s private configuration generator, `scripts/create-bootlister-key.mjs`, to create the paired server values. Keep that file outside source control. Never copy WBW’s Supabase service-role key into Bootlister. A rotated/removed receiver digest or revoked WBW admin role immediately disables the connection.

`/api/wbw` verifies the caller’s signed Bootlister admin session and resolves the selected seller before looking up stored details or sending requests. Seller sessions cannot use this endpoint. Remote requests go only to `https://westernbootworld.com/api/bootlister`; redirects are refused so the key cannot follow a redirect elsewhere.

## Retry and limits

Bootlister stores a stable UUID on each seller, preserved across renames, and sends the existing stable item ID. WBW uses those IDs to prevent duplicate insertion after retries or concurrent requests. One item is transferred per request, with 1–30 public HTTPS photos. Existing images in Bootlister are kept; WBW stores its own copies. Failed photos stop that pair before saving it.

Unchanged re-sends return the existing WBW pair. Sending a saved draft live reuses its ID. Changed source data or an existing matching WBW source URL returns a conflict for review; this connection never overwrites an existing listing automatically. A conditional local receipt detects changes made while a transfer is running.

This adds an operator-driven initial transfer. It does not schedule imports, synchronize sold states, delete WBW inventory or implement bidirectional updates. Sold, removed, archived and pending-sold items cannot be sent as current inventory. Intentional WBW deletions should be reconciled before a later manual resend.
