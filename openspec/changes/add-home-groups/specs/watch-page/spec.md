## ADDED Requirements

### Requirement: Home by product

Home SHALL group the checks that are on by product. Each site or job service SHALL be a product,
and a GitHub repository SHALL join it when their names match once case and punctuation are
dropped and no other site or repository has that name; the product SHALL take the site's own
name. A repository that joins no site SHALL be a product of its own, named with its owner, and
each vendor service and AWS account SHALL be a product of its own. Each product SHALL show how
many of its checks pass and its worst state, with products that have a problem first. Once a scan
has been applied, Home SHALL say how many checks in the latest scan nobody has decided on and
SHALL open the review from that line, and the review SHALL mark those checks as new.

#### Scenario: A product with a site and a repository

- **WHEN** Watch has `custom:shop` checking the site and `github:acme/shop` checking CI
- **THEN** Home shows one product, Shop, with both checks

#### Scenario: A site named like two repositories

- **WHEN** Watch has `custom:api` checking a site, and `github:acme/api` and `github:example/api`
  checking CI
- **THEN** Home shows three products, since the site cannot tell which repository is its own

#### Scenario: A rescan with new checks

- **WHEN** a scan after the first apply suggests three new checks
- **THEN** Home says there are 3 new checks to review, and its button opens the review, which
  marks those three New, has Back to Home and ticks checks as they stand now
