import type { PropertyCandidate } from "./types";

export const mockProperties: PropertyCandidate[] = [
  {
    id: "prop-001",
    propertyCode: "0001",
    title: "شقة قريبة من المستشفى الإسباني",
    type: "شقة",
    area: "تفرغ زينة",
    landmark: "المستشفى الإسباني",
    price: 2400,
    rooms: 2
  },
  {
    id: "prop-002",
    propertyCode: "0002",
    title: "شقة هادئة قرب كارفور",
    type: "شقة",
    area: "تفرغ زينة",
    landmark: "كارفور",
    price: 2500,
    rooms: 3
  },
  {
    id: "prop-003",
    propertyCode: "0003",
    title: "منزل عائلي في لكصر",
    type: "منزل",
    area: "لكصر",
    landmark: "قرب السوق",
    price: 1800,
    rooms: 3
  }
];
