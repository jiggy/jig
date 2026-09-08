import { defineJig, discover } from '@jigging/jig'

export default defineJig({ flows: discover('flows') })
