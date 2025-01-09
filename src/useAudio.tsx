import React, { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";

type useAudioProps = {
  socket: null | Socket;
  stream: null | MediaStream;
  event: string;
};

const useAudio = ({ socket, stream, event }: useAudioProps) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  useEffect(() => {
    if (!socket || !stream || stream.getAudioTracks().length === 0) return;
    audioContextRef.current = new window.AudioContext();

    // 미디어 스트림을 오디오 컨텍스트로 연결
    const source = audioContextRef.current.createMediaStreamSource(stream);

    // 오디오 분석기 생성
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;

    const bufferLength = analyserRef.current.frequencyBinCount;
    dataArrayRef.current = new Uint8Array(bufferLength);

    source.connect(analyserRef.current);

    const checkAudioLevel = () => {
      if (!analyserRef.current || !dataArrayRef.current) return;
      // 오디오 데이터 수집
      analyserRef.current.getByteFrequencyData(dataArrayRef.current);

      // 오디오 레벨 계산
      const audioLevel =
        dataArrayRef.current.reduce((acc, val) => acc + val, 0) / bufferLength;

      // 오디오 레벨이 10 이상이면 로그 출력
      if (audioLevel > 10) {
        socket.emit("sounds", event);
      }

      // 일정 간격으로 실행
      requestAnimationFrame(checkAudioLevel);
    };

    // 오디오 레벨 체크 시작
    checkAudioLevel();

    // 클린업 함수
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [socket, stream]);
  return {};
};

export default useAudio;
