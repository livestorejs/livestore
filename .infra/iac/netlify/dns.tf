# DNS for `livestore.dev`, whose zone is hosted on Netlify.
#
# Scope: only the hand-authored records. The zone also contains `NETLIFY`-type
# records (docs.livestore.dev, www, next, dev, …) which Netlify creates and owns
# from each site's domain settings — the provider cannot even express that type,
# so they are driven through `netlify_site_domain_settings` below rather than
# declared here.
#
# There is no `netlify_dns_zone` resource: the zone is referenced by its literal
# id so OpenTofu can never create, replace, or delete it. Records are additive
# and individually replaceable; a zone is not.
#
# Most of these serve a live Clerk instance (verified responding at
# `clerk.livestore.dev`) that has no consumer anywhere in this repository. They
# are declared because they are load-bearing, not because their purpose is
# understood — see the open question in the infrastructure node.

locals {
  livestore_dev_zone_id = "6729e87827f61742878061ad"

  livestore_dev_dns_records = {
    "accounts"                   = { type = "CNAME", hostname = "accounts.livestore.dev",                  value = "accounts.clerk.services" }
    "accounts_dev"               = { type = "CNAME", hostname = "accounts.dev.livestore.dev",              value = "accounts.clerk.services" }
    "atproto"                    = { type = "TXT",  hostname = "_atproto.livestore.dev",                  value = "did=did:plc:dfj2wvnu7ihimhqelg2w6rhs" }
    "clerk"                      = { type = "CNAME", hostname = "clerk.livestore.dev",                     value = "frontend-api.clerk.services" }
    "clerk_dev"                  = { type = "CNAME", hostname = "clerk.dev.livestore.dev",                 value = "frontend-api.clerk.services" }
    "clk2_domainkey"             = { type = "CNAME", hostname = "clk2._domainkey.livestore.dev",           value = "dkim2.60jvf0ud8f6z.clerk.services" }
    "clk2_domainkey_dev"         = { type = "CNAME", hostname = "clk2._domainkey.dev.livestore.dev",       value = "dkim2.h0a6cebiky4v.clerk.services" }
    "clk_domainkey"              = { type = "CNAME", hostname = "clk._domainkey.livestore.dev",            value = "dkim1.60jvf0ud8f6z.clerk.services" }
    "clk_domainkey_dev"          = { type = "CNAME", hostname = "clk._domainkey.dev.livestore.dev",        value = "dkim1.h0a6cebiky4v.clerk.services" }
    "clkmail"                    = { type = "CNAME", hostname = "clkmail.livestore.dev",                   value = "mail.60jvf0ud8f6z.clerk.services" }
    "clkmail_dev"                = { type = "CNAME", hostname = "clkmail.dev.livestore.dev",               value = "mail.h0a6cebiky4v.clerk.services" }  }
}

resource "netlify_dns_record" "livestore_dev" {
  for_each = local.livestore_dev_dns_records

  zone_id  = local.livestore_dev_zone_id
  type     = each.value.type
  hostname = each.value.hostname
  value    = each.value.value
}

# Custom domains per site. This is the layer that drives the `NETLIFY`-type
# records in the zone above: attaching a domain here is what makes Netlify
# create the corresponding record, so this is the honest place to own them.
resource "netlify_site_domain_settings" "docs_prod" {
  site_id       = local.docs_surfaces.prod.site_id
  custom_domain = "docs.livestore.dev"
}

resource "netlify_site_domain_settings" "docs_dev" {
  site_id        = local.docs_surfaces.dev.site_id
  custom_domain  = "dev.docs.livestore.dev"
  domain_aliases = ["next.livestore.dev"]
}
