import React from "react";
import { SERVER_ORIGIN } from "../../api";

export default function ProductImage({ Icon, size = 34, src }) {
  if (src) {
    const fullSrc = src.startsWith("http") ? src : `${SERVER_ORIGIN}${src}`;
    return (
      <div className="product-img product-img-photo">
        <img src={fullSrc} alt="" loading="lazy" />
      </div>
    );
  }
  return (
    <div className="product-img">
      <Icon size={size} strokeWidth={1.25} />
    </div>
  );
}
