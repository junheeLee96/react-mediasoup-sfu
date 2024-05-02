import { types } from "mediasoup-client";

export type userType = {
  [key: string]: { stream: MediaStream };
};

export type DeviceType = types.Device;

export type producerTransportType = types.Transport;

export type rtpCapabilitesType = types.RtpCapabilities;

export interface consumerTransportsType {
  consumer: types.Consumer;
  consumerTransport: producerTransportType;
  producerId: string;
  serverConsumerTransportId: producerTransportType;
}

export type funcType = ([param]?: any) => void;
