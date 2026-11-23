# Where this runtime comes from

This folder is an unchanged copy of the browser runtime from the Open Agentic Web
challenge's `agentify-website` skill:
https://github.com/cognizant-ai-labs/agentic-web/tree/main/skills/agentify-website/runtime
(agentic-web commit 3ea4b3f 2026-11-23 13:17:09 -0800). That copy is nsdeploy's runtime (Apache-2.0, see LICENSE.txt)
with the edits its README.md lists: partner sites' shared actions become `website_*`
tools, partner networks run on the caller's model and step limit, and a
publisher-funded default router (`llm_router.publisher_funded`).

Pocket Web uses this copy because most listed agent sites are built with it. A peer such
as Recalled? answers through `website_*` tools that the plain nsdeploy runtime does not offer.
Pocket Web makes no edits here. To update, copy the folder again and run the tests.
