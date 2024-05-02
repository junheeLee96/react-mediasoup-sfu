import styled from "@emotion/styled";
import { Button } from "@mui/material";
import React from "react";
import { Link } from "react-router-dom";

const Home = () => {
  return (
    <HomeStyle>
      <Link to="/room/123">
        <Button variant="contained">Go to Room</Button>
      </Link>
    </HomeStyle>
  );
};

export default Home;

const HomeStyle = styled.div`
  width: 100vw;
  height: 100vh;
  background: rgb(17, 23, 30);
  display: flex;
  align-items: center;
  justify-content: center;
`;
