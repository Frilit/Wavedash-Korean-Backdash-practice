import type { Metadata } from "next";
import MovementTrainer from "./components/MovementTrainer";

export const metadata: Metadata = {
  title: "Tekken Movement Trainer — Wavedash & KBD Practice",
  description: "Practice Korean backdash and Mishima-style wavedash timing with browser-observed keyboard and gamepad input.",
};

export default function Home() {
  return <MovementTrainer />;
}
