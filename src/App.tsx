import "./App.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./Home";
import MeetRoom from "./MeetRoom";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomName" element={<MeetRoom />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
