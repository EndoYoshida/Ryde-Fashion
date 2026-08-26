import { useState, useEffect, useRef, useCallback } from "react";
import { regions, provinces, cities, barangays } from "select-philippines-address";

// Shared Province -> City -> Barangay cascade, backed by the official PSGC
// dataset (via select-philippines-address). Used by both Checkout and the
// Account profile form so the two stay on the same real address data
// instead of drifting apart (one validated, one free-typed).
//
// Metro Manila fix: PSGC has no real "provinces" under NCR — the dataset
// only gives four legislative-district groupings ("NCR, City of Manila,
// First District", "Second District", ...), and each of those only lists
// the one or two cities that happen to sit in that district. Picked as a
// "province" the old checkout code, that meant e.g. picking the "City of
// Manila" district showed a City dropdown with just "City of Manila" in
// it — no Quezon City, no Makati, nothing — because those cities belong to
// *other* districts. This collapses the four districts into a single
// "Metro Manila" entry, and when it's selected, merges the cities from all
// four districts into one complete, deduplicated list of the real 16
// cities + Pateros.
const NCR_LABEL = "Metro Manila";
const looksLikeNCR = (name) => /manila|ncr|national capital|district/i.test(name || "");

export function usePhAddressCascade() {
  const [provinceOptions, setProvinceOptions] = useState([]);
  const [cityOptions, setCityOptions] = useState([]);
  const [barangayOptions, setBarangayOptions] = useState([]);
  const [loadingProvinces, setLoadingProvinces] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingBarangays, setLoadingBarangays] = useState(false);

  const [address, setAddress] = useState({
    province: "", provinceCode: "",
    city: "", cityCode: "",
    barangay: "",
  });

  // Saved names (e.g. from a customer profile) still waiting to be matched
  // up with a code once their option list has loaded.
  const [pendingNames, setPendingNames] = useState({ province: "", city: "", barangay: "" });

  const ncrDistrictCodesRef = useRef([]);

  // Load provinces once, collapsing NCR's district groupings into one
  // "Metro Manila" entry (see note above).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const allRegions = await regions();
        const ncrRegion = allRegions.find((r) => looksLikeNCR(r.region_name));
        const perRegion = await Promise.all(allRegions.map((r) => provinces(r.region_code)));
        let flat = perRegion.flat().map((p) => ({
          code: p.province_code, name: p.province_name, regionCode: p.region_code,
        }));

        if (ncrRegion) {
          const ncrDistricts = flat.filter((p) => p.regionCode === ncrRegion.region_code);
          ncrDistrictCodesRef.current = ncrDistricts.map((d) => d.code);
          flat = flat.filter((p) => p.regionCode !== ncrRegion.region_code);
          if (ncrDistricts.length > 0) {
            flat.push({ code: `ncr:${ncrRegion.region_code}`, name: NCR_LABEL, isNCR: true });
          }
        }

        flat.sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setProvinceOptions(flat);
      } catch (err) {
        console.error("Failed to load provinces:", err);
      } finally {
        if (!cancelled) setLoadingProvinces(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cities cascade from the chosen province — for "Metro Manila" this
  // fetches every NCR district's cities and merges them into one list.
  useEffect(() => {
    if (!address.provinceCode) { setCityOptions([]); return; }
    let cancelled = false;
    setLoadingCities(true);
    (async () => {
      try {
        const isNCR = address.provinceCode.startsWith("ncr:");
        let list;
        if (isNCR) {
          const lists = await Promise.all(ncrDistrictCodesRef.current.map((code) => cities(code)));
          const merged = new Map();
          lists.flat().forEach((c) => {
            if (!merged.has(c.city_name)) merged.set(c.city_name, c);
          });
          list = [...merged.values()];
        } else {
          list = await cities(address.provinceCode);
        }

        if (cancelled) return;
        const opts = list.map((c) => ({ code: c.city_code, name: c.city_name }));
        opts.sort((a, b) => a.name.localeCompare(b.name));
        setCityOptions(opts);
      } catch (err) {
        console.error("Failed to load cities:", err);
      } finally {
        if (!cancelled) setLoadingCities(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address.provinceCode]);

  // Barangays cascade from the chosen city — this already works fine for
  // Manila itself (it returns Manila's real barangays), so no special-
  // casing needed here.
  useEffect(() => {
    if (!address.cityCode) { setBarangayOptions([]); return; }
    let cancelled = false;
    setLoadingBarangays(true);
    barangays(address.cityCode)
      .then(async (list) => {
        if (cancelled) return;
        setBarangayOptions(list.map((b) => ({ code: b.brgy_code, name: b.brgy_name })));
      })
      .catch((err) => console.error("Failed to load barangays:", err))
      .finally(() => !cancelled && setLoadingBarangays(false));
    return () => { cancelled = true; };
  }, [address.cityCode]);

  // Resolve a saved province name into a real code once options are ready.
  useEffect(() => {
    if (!pendingNames.province || address.provinceCode || provinceOptions.length === 0) return;
    const lower = pendingNames.province.toLowerCase();
    const match = provinceOptions.find((p) => p.name.toLowerCase() === lower)
      || (looksLikeNCR(lower) ? provinceOptions.find((p) => p.isNCR) : null);
    if (match) setAddress((a) => ({ ...a, province: match.name, provinceCode: match.code }));
  }, [provinceOptions, pendingNames.province, address.provinceCode]);

  // Then resolve the saved city, once that province's city list is ready.
  useEffect(() => {
    if (!pendingNames.city || address.cityCode || cityOptions.length === 0) return;
    const lower = pendingNames.city.toLowerCase();
    const match = cityOptions.find((c) => c.name.toLowerCase() === lower);
    if (match) setAddress((a) => ({ ...a, city: match.name, cityCode: match.code }));
  }, [cityOptions, pendingNames.city, address.cityCode]);

  // Then the saved barangay, once that city's barangay list is ready.
  useEffect(() => {
    if (!pendingNames.barangay || barangayOptions.length === 0) return;
    const lower = pendingNames.barangay.toLowerCase();
    const match = barangayOptions.find((b) => b.name.toLowerCase() === lower);
    if (match) setAddress((a) => ({ ...a, barangay: match.name }));
  }, [barangayOptions, pendingNames.barangay]);

  // Feed in a saved address (e.g. from the customer's account profile) so
  // it displays immediately and resolves to real codes as each option
  // list loads in. Safe to call more than once (e.g. while a profile is
  // still loading) — it never overwrites something the shopper already
  // picked themselves.
  const hydrate = useCallback((province, city, barangay) => {
    setAddress((a) => ({
      ...a,
      province: a.province || province || "",
      city: a.city || city || "",
      barangay: a.barangay || barangay || "",
    }));
    setPendingNames((p) => ({
      province: p.province || province || "",
      city: p.city || city || "",
      barangay: p.barangay || barangay || "",
    }));
  }, []);

  const selectProvince = (opt) => {
    setPendingNames({ province: "", city: "", barangay: "" });
    setAddress({ province: opt.name, provinceCode: opt.code, city: "", cityCode: "", barangay: "" });
  };
  const clearProvince = () => {
    setPendingNames({ province: "", city: "", barangay: "" });
    setAddress({ province: "", provinceCode: "", city: "", cityCode: "", barangay: "" });
  };
  const selectCity = (opt) => {
    setPendingNames((p) => ({ ...p, city: "", barangay: "" }));
    setAddress((a) => ({ ...a, city: opt.name, cityCode: opt.code, barangay: "" }));
  };
  const clearCity = () => {
    setPendingNames((p) => ({ ...p, city: "", barangay: "" }));
    setAddress((a) => ({ ...a, city: "", cityCode: "", barangay: "" }));
  };
  const selectBarangay = (opt) => {
    setPendingNames((p) => ({ ...p, barangay: "" }));
    setAddress((a) => ({ ...a, barangay: opt.name }));
  };
  const clearBarangay = () => {
    setPendingNames((p) => ({ ...p, barangay: "" }));
    setAddress((a) => ({ ...a, barangay: "" }));
  };

  return {
    address,
    provinceOptions, cityOptions, barangayOptions,
    loadingProvinces, loadingCities, loadingBarangays,
    selectProvince, clearProvince,
    selectCity, clearCity,
    selectBarangay, clearBarangay,
    hydrate,
  };
}
