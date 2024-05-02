import React, { useEffect, useRef } from "react";

const Users = ({ user, id }: any) => {
  const videoRef = useRef<null | HTMLVideoElement>(null);
  const audioRef = useRef<null | HTMLAudioElement>(null);

  useEffect(() => {
    const { stream } = user;
    if (user.stream.getVideoTracks()) {
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
    } else {
      if (!audioRef.current) return;
      audioRef.current.srcObject = stream;
    }
  }, []);
  return (
    <div id={`remote-video ${id}`}>
      {user.stream.getVideoTracks() ? (
        <video ref={videoRef} autoPlay playsInline muted={true} />
      ) : (
        <audio ref={audioRef} autoPlay muted={true} />
      )}
    </div>
  );
};

export default Users;
