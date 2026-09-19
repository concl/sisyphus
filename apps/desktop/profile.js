const path = require('node:path')
/** Desktop composition root. Cordis owns lifecycle and dependency injection. */
module.exports = ({ userData, hostDir, frontend, smoke }) => [
  require('./plugins/transport')(),
  require('./plugins/storage')(path.join(userData, 'storage')),
  require('./plugins/preferences')({ userData }),
  require('./plugins/agent-tools')(),
  require('./plugins/planner-data')(),
  require('./plugins/files')(),
  require('./plugins/shell')(),
  require('./plugins/chat')({ userData }),
  require('./plugins/planner-sync')(),
  require('./plugins/terminal')(),
  require('./plugins/python-host')({ hostDir }),
  require('./plugins/window')({ frontend, smoke }),
]
