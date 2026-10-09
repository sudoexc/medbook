/**
 * Tickets straight to the network receipt printer (owner request
 * 09.10.2026): the ESC/POS writer, the slip, the agent's installer.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import { EscPos, LINE_WIDTH, encodeCp866, wrap } from "@/server/print/escpos";
import { renderTicketEscPos, type TicketSlip } from "@/server/print/ticket";
import { AGENT_SCRIPT, installerBat } from "@/server/print/agent-script";
import { hashAgentToken } from "@/server/print/agent";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const has = (buf: Buffer, bytes: number[]) => buf.indexOf(Buffer.from(bytes)) >= 0;

describe("ESC/POS", () => {
  it("Cyrillic in PC866, the rest as the nearest it has", () => {
    expect(encodeCp866("АЯаяРр")).toEqual([0x80, 0x9f, 0xa0, 0xef, 0x90, 0xe0]);
    expect(encodeCp866("Ёё№")).toEqual([0xf0, 0xf1, 0xfc]);
    expect(encodeCp866("A-1")).toEqual([0x41, 0x2d, 0x31]);
    expect(encodeCp866("«o‘zbek»")).toEqual(encodeCp866('"o\'zbek"'));
  });

  it("starts with init and code page 17, cuts at the end", () => {
    const b = new EscPos().line("x").cut().toBuffer();
    expect([...b.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 17]);
    expect([...b.subarray(-4)]).toEqual([0x1d, 0x56, 66, 3]);
  });

  it("a label left, a value right, wrapping under, never past the line", () => {
    const p = new EscPos();
    p.pair("Врач:", "Исраилова Феруза Камиловна очень длинное имя врача для проверки переноса");
    const text = Buffer.from(p.toBuffer().subarray(5));
    const lines = text.toString("latin1").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(LINE_WIDTH);
  });

  it("wraps words and cuts a word longer than the line", () => {
    expect(wrap("a bb ccc", 4)).toEqual(["a bb", "ccc"]);
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("a native QR with the data stored, then printed", () => {
    const b = new EscPos().qr("https://t.me/neurofaxbot?start=abc").toBuffer();
    expect(has(b, [0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0])).toBe(true);
    expect(b.includes(Buffer.from("https://t.me/neurofaxbot?start=abc"))).toBe(true);
    expect(has(b, [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30])).toBe(true);
  });
});

describe("the slip", () => {
  const slip: TicketSlip = {
    locale: "ru",
    clinicName: "NeuroFax",
    clinicAddress: "г. Ташкент, Учтепа",
    clinicPhone: "+998 (71) 275-28-18",
    ticketNumber: "A-021",
    slotTime: "14:30",
    patient: "Абдуллаева М.",
    doctorName: "Султанов Азиз Бахтиёр угли",
    cabinet: "5",
    serviceName: "",
    issuedAt: "09.10.2026, 14:30",
    waitingAhead: 2,
    botUrl: "https://t.me/neurofaxbot?start=tok",
  };

  it("carries the number big, the doctor, the cabinet, the bot QR and the cut", () => {
    const b = renderTicketEscPos(slip);
    expect(b.includes(Buffer.from(encodeCp866("ВАШ НОМЕР")))).toBe(true);
    expect(has(b, [0x1d, 0x21, 0x33])).toBe(true); // 4× size for the number
    expect(b.includes(Buffer.from("A-021"))).toBe(true);
    expect(b.includes(Buffer.from(encodeCp866("Султанов")))).toBe(true);
    expect(b.includes(Buffer.from("https://t.me/neurofaxbot?start=tok"))).toBe(true);
    expect([...b.subarray(-4)]).toEqual([0x1d, 0x56, 66, 3]);
  });

  it("a slip without a bot has no QR", () => {
    const b = renderTicketEscPos({ ...slip, botUrl: null });
    expect(has(b, [0x1d, 0x28, 0x6b])).toBe(false);
  });
});

describe("the agent", () => {
  it("the installer writes the config, starts hidden at sign-in, no admin rights", () => {
    const bat = installerBat({ server: "https://neurofax.uz", token: "TOKEN123" });
    expect(bat).toContain('> "%DIR%\\agent.conf" echo SERVER=https://neurofax.uz');
    expect(bat).toContain('>> "%DIR%\\agent.conf" echo TOKEN=TOKEN123');
    expect(bat).toContain("-WindowStyle Hidden");
    expect(bat).toContain("Start Menu\\Programs\\Startup\\NeuroFax Print.vbs");
    expect(bat).not.toContain("schtasks");
    // Every & in an echo line must sit inside cmd's quotes (after an odd
    // number of "), where it is literal; a ^ there would be written into
    // start.vbs as is and break the PowerShell command.
    for (const line of bat.split("\r\n").filter((l) => l.includes("echo "))) {
      expect(line).not.toContain("^");
      let quotes = 0;
      for (const ch of line) {
        if (ch === '"') quotes++;
        if (ch === "&") expect(quotes % 2, line).toBe(1);
      }
    }
    expect(bat).toContain("catch {}; & '%DIR%\\agent.ps1'");
  });

  it("the script long-polls, writes raw bytes to port 9100's host, reports back", () => {
    expect(AGENT_SCRIPT).toContain("/api/print-agent/jobs");
    expect(AGENT_SCRIPT).toContain("New-Object System.Net.Sockets.TcpClient");
    expect(AGENT_SCRIPT).toContain("[Convert]::FromBase64String($job.data)");
    expect(AGENT_SCRIPT).toContain("'Local\\NeuroFaxPrintAgent'");
  });

  it("tokens are stored hashed", () => {
    expect(hashAgentToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(read("prisma/migrations/20261009120000_print_agents/migration.sql")).toContain('"tokenHash" TEXT NOT NULL');
  });

  it("the job API never prints a stale ticket and claims each job once", () => {
    const jobs = read("src/app/api/print-agent/jobs/route.ts");
    expect(jobs).toContain('data: { status: "FAILED", error: "expired" }');
    expect(jobs).toContain('where: { id: job.id, status: "QUEUED" },');
  });

  it("texts in both languages, no dashes", () => {
    expect(Object.keys(uz.ticketPrint).sort()).toEqual(Object.keys(ru.ticketPrint).sort());
    for (const m of [ru, uz]) for (const v of Object.values(m.ticketPrint)) expect(v).not.toMatch(/[—–]/);
  });
});
