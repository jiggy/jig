---
pageType: home
title: FLOW
description: Portable workflow packages and process contracts.

hero:
  name: FLOW
  text: Workflows as ordinary, portable packages.
  tagline: FLOW defines the small file and process boundaries that let packages run under independent hosts without giving those hosts ownership of application meaning.
  actions:
    - theme: brand
      text: Read the specifications
      link: /guide/
    - theme: alt
      text: View the source
      link: https://github.com/jigmd/jig/tree/main/docs/flow

features:
  - title: Ordinary files
    details: A FLOW package is a directory with FLOW.md, an optional implementation, schemas, skills, and colocated resources.
    icon: "◫"
  - title: Small process boundary
    details: Run/1 is one finite, language-neutral exchange between a package process and its host.
    icon: "↔"
  - title: Independently implementable
    details: FLOW specifies portable meaning. Hosts such as Jig choose admission, authority, isolation, and lifecycle policy.
    icon: "◇"
---
