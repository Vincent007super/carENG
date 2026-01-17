import { useState } from 'react'
import './App.css'
import EngineDemo from './EngineDemo'

function App() {
  const [simulationData, setSimulationData] = useState(null)

  return <EngineDemo />;
}

export default App;