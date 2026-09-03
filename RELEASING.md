# Automatic npm prereleases

The exact prerelease version in each public package manifest is release intent.
After CI succeeds for a reviewed merge to `main`, the release workflow builds
both package candidates and tests their exact archives while a read-only gate
waits for complete Linux Host Conformance on that same push revision. Only
after both succeed may it publish a version not yet present on npm, refetch the
registry bytes, and create package-specific annotated source tags.

There is no release button, version input, npm token, or separately rebuilt
archive. The workflow publishes through npm trusted publishing in the `npm`
GitHub environment. `@jigging/flow` always converges before `@jigging/jig`.
The build matrix has no OIDC or Git write authority; the publish job has no
checkout and executes no repository code.

## Releasing a version

In the ordinary reviewed change:

1. set the desired exact prerelease version in each package being released;
2. keep `private` absent and `publishConfig.access` equal to `public`;
3. update packed-package assertions and public documentation for that version;
4. include every source, lock, notice, and manifest change for the release; and
5. merge only after the source, packed-package, Operational Baseline/1, and
   applicable pull-request Linux hostile gates pass. Publication additionally
   requires complete Linux Host Conformance on the exact merged revision.

The supported prerelease forms are `*-alpha.*` and `*-next.*`; their first
prerelease identifier selects the npm dist-tag. `latest` is never moved by this
workflow.

On the successful CI result, both candidates are built once in parallel from
CI's exact source revision. A separate authorization job accepts only a
successful `main` push run of the complete Linux Host Conformance workflow for
that same revision. The publish job consumes only the retained candidate
archives and processes Flow before Jig. If a version already exists, its
registry archive must be byte-for-byte identical to the candidate. Changed
package bytes under an existing version fail with an instruction to bump that
package's version; npm versions are never replaced.

After registry convergence, the workflow creates any missing
`flow-v<version>` or `jig-v<version>` tag. A newly published version must tag
the exact candidate commit. An existing tag is never moved; when its package
was unchanged, it remains on the earlier release commit.

## Failure recovery

If candidate construction fails, fix the source in a new reviewed commit. If
publication may have succeeded but its response or a later gate failed, use
GitHub's **Re-run failed jobs** action. The successful build matrix is not
rerun, and the publish job converges against its retained seven-day artifacts.
If Host Conformance failed because of a transient host fault, rerun that exact
workflow before rerunning the failed authorization and publication jobs. A
later push is a new candidate, not an uncertainty retry.
