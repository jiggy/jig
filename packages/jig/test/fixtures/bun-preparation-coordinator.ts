import { openPrivateProjectCoordinator } from '../../src/internal/activation-admission-store.js'
import { preparePrivateBunPackage } from '../../src/internal/bun-native-preparation.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { capturePackageDirectory } from '../../src/package/capture.js'
import { installedBunLocation } from './installed-bun-location.js'

const [projectRoot, packageRoot, resolutionPermission] = process.argv.slice(2)
if (projectRoot === undefined || packageRoot === undefined) {
  throw new Error('preparation coordinator fixture arguments are missing')
}

const captured = await capturePackageDirectory(packageRoot)
const coordinator = await openPrivateProjectCoordinator({ projectRoot })
try {
  const host = await openPrivateInstalledBunHost(installedBunLocation)
  const prepared = await preparePrivateBunPackage({
    captured,
    installedSupport: host.installedBunSupport,
    backend: host.backend,
    projectRoot,
    coordinator,
    allowResolutionNetwork: resolutionPermission === '--allow-resolution-network',
  })
  await prepared.captured.dispose()
} finally {
  await coordinator.dispose()
  await captured.dispose()
}
