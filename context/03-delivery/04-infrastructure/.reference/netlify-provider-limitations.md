# What the Netlify OpenTofu provider cannot express

External platform constraint, recorded because `.infra/iac/netlify/` cannot be
read as a complete description of the account without it. Observed 2026-07-27
against provider `netlify/netlify` v0.4.4.

Each entry is a case where the live API can do something the provider cannot,
so the config is silent about it by necessity rather than by choice.

## A custom domain cannot be released

`netlify_site_domain_settings` can set `custom_domain`, but not remove one:

- `custom_domain = null` is silently omitted from the request. The apply
  reports success, changes nothing, and the next plan shows the same diff
  forever.
- `custom_domain = ""` is rejected by the API with `{"errors":"Name is blank"}`.

The API itself has no such limitation — `PATCH /api/v1/sites/{site_id}` with
`{"custom_domain": null}` returns 200 and clears it. Releasing a domain is
therefore a direct API call, and the config expresses the result by declaring
the resource *without* a `custom_domain`, which keeps the absence checked.

This matters beyond tidiness: a resource whose desired state cannot be reached
makes every subsequent plan dirty, which would leave the scheduled drift check
permanently red and train readers to ignore it.

## `NETLIFY`-type DNS records cannot be declared

The zone for a Netlify-hosted domain contains `NETLIFY`-type records that
Netlify creates from each site's domain settings. `netlify_dns_record` accepts
only `A, AAAA, ALIAS, CAA, CNAME, MX, NS, SPF, TXT`, so those records cannot be
declared at all. They are governed indirectly through
`netlify_site_domain_settings`: attaching or releasing a domain is what makes
Netlify publish or withdraw the record.

The failure mode this creates is real. A record can outlive the claim that
produced it — `linearlite.livestore.dev` pointed at a site that no longer
claimed it, so nothing withdrew the record and nothing could remove it through
the provider either. Deleting it required
`DELETE /api/v1/dns_zones/{zone_id}/dns_records/{record_id}`.

An orphaned record of this kind is invisible to the drift check, because the
config cannot name it. Zone-level record inventory is not covered by
`LS.DEL.INFRA-R01` today.
