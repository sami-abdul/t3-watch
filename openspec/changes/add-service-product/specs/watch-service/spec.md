## ADDED Requirements

### Requirement: Name a service's product

A service SHALL be able to carry a product name of up to 60 characters with a letter or a digit,
set with `watch_set_product`; an empty name SHALL clear it, and control characters and invisible
ones that reorder text SHALL be refused. Names SHALL compare without case, accents or punctuation,
in any script, and a product SHALL have one spelling: naming it in a new spelling SHALL respell it
for its other services. Home SHALL group a service with a named product under that name, ahead of
any guess from names. A site or repository with no name of its own SHALL join a named product
whose name matches its own, and a repository SHALL follow the site it matches, wherever that site
goes. A rescan SHALL keep a service's product name.

#### Scenario: A site whose repository has another name

- **WHEN** an agent names the product of the site `shop.example.com` "Storefront", and the
  repository `acme/storefront` is watched too
- **THEN** Home shows one product, Storefront, holding the checks of both

#### Scenario: Back to the guess

- **WHEN** an agent sets an empty product name on a service
- **THEN** Home groups it by names again

#### Scenario: A rescan

- **WHEN** a rescan finds a service whose product was named
- **THEN** the service keeps its product name

#### Scenario: A new spelling

- **WHEN** two services are named "Storefront" and an agent names one of them "StoreFront"
- **THEN** both carry "StoreFront", and Home shows that spelling
