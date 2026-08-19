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
  },
  // Paging only starts after five results, so the simulator needs enough of them to reach page two.
  {
    id: "prop-004",
    propertyCode: "0004",
    title: "شقة قرب قصر المؤتمرات",
    type: "شقة",
    area: "تفرغ زينة",
    landmark: "قصر المؤتمرات",
    price: 3200,
    rooms: 3
  },
  {
    id: "prop-005",
    propertyCode: "0005",
    title: "غرفة قرب الجامعة",
    type: "غرفة",
    area: "تفرغ زينة",
    landmark: "الجامعة",
    price: 1200,
    rooms: 1
  },
  {
    id: "prop-006",
    propertyCode: "0006",
    title: "شقة واسعة قرب السوق المركزي",
    type: "شقة",
    area: "تفرغ زينة",
    landmark: "السوق المركزي",
    price: 4000,
    rooms: 4
  },
  {
    id: "prop-007",
    propertyCode: "0007",
    title: "منزل قرب المستشفى الوطني",
    type: "منزل",
    area: "تفرغ زينة",
    landmark: "المستشفى الوطني",
    price: 2800,
    rooms: 3
  }
];
