# Domain move: hike.bbprojectfactory.com is canonical, the old subdomain is removed

Babar, 6 Nov 2026: "the subdomain also needs to move over to hike.bbprojectfactory.com and the other one can be removed." Then: "Remove now". There is no redirect: old shared links to the previous subdomain will stop resolving (Babar's decision).

Steps 1 and 2 are DONE (6-7 Nov 2026, by the PM in hPanel at Babar's request): Git deploy of branch `hostinger` into public_html with auto-deploy on, Let's Encrypt certificate valid, and `/`, `/trails/index.json`, `/privacy/`, `/support/` return 200. Steps in order:

1. **Create the new site. DONE.**
   - hPanel > Websites > bbprojectfactory.com > Domains > Subdomains > create `hike`. Document root: the folder the Git deploy uses (default `public_html/hike`). Empty the subdomain's folder first (Hostinger may add a default index file; Git deploy may need an empty folder).
   - Advanced > Git: check the existing old-subdomain Git deploy settings and copy them. Repository `https://github.com/mishamachine/ridgeline`, branch `hostinger`, directory = the `hike` document root, auto-deploy on push. Deploy once by hand.
   - Security > SSL: install the free Let's Encrypt certificate for hike.bbprojectfactory.com (DNS is on Hostinger: checked with dig on 6 Nov, NS is dns-parking.com; so the record comes with the subdomain; allow a few minutes).
2. **Verify. DONE** (200s confirmed for /, /trails/index.json, /privacy/, /support/; the checks below are the full list):
   - `curl -I https://hike.bbprojectfactory.com/` returns 200
   - `curl -I https://hike.bbprojectfactory.com/trails/index.json` returns 200
   - `/privacy/` and `/support/` return 200, and `/sitemap.xml` returns 200
   - `curl -I http://hike.bbprojectfactory.com/` returns a 301 to https
3. **Merge this PR** (gate open: step 2 passed). The `hostinger` branch is rebuilt and auto-deploys. Then check the served HTML shows the new canonical.
4. **Delete the old subdomain** in hPanel, and its Git deploy. Done by the PM in hPanel AFTER this PR is live and verified.
5. **Search Console (after step 4):** add property `hike.bbprojectfactory.com` and submit `https://hike.bbprojectfactory.com/sitemap.xml`. Change of Address is not possible without a redirect from the old host, so the new property starts fresh.

## Next PR
Flip `features.celebrate` and add the share-card privacy paragraph to the privacy policy (a privacy sentence ships with the behaviour it describes).

## Rollback
Revert the PR only before step 4. After the old subdomain is deleted, a revert would point the canonical at a dead host. The new subdomain can stay. The old subdomain cannot be restored by this repo once deleted in hPanel.
