// The logo, from the kit in brand/final (copied to public/logo as it is, never redrawn). The site draws it at 32px and
// under everywhere, so it uses the kit's small cut, whose bigger notches still read as a ticket's at that size: the
// symbol alone, and the lockups drawn with it. Every file comes in colour, for light backgrounds, and a dark version
// for dark ones. Both go in the page and utilities.css shows the one for the
// theme, so the right one is there on first paint and swaps with the header's toggle.
export default function Logo({ file, alt = "", className }) {
  return ["color", "dark"].map((v) => (
    <img key={v} className={`${className} ${v === "dark" ? "dark-only" : "light-only"}`} src={`/logo/${file}-${v}.svg`} alt={alt} />
  ));
}
